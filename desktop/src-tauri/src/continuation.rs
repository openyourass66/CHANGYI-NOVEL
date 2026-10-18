use crate::database::{execute, id, now, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn route(
    db: &mut Connection,
    method: &str,
    parts: &[&str],
    path: &str,
    body: &Value,
) -> Option<Result<Value>> {
    let result = match (method, parts) {
        ("GET", ["api", "projects", project_id, "plans"]) => {
            list_plans(db, project_id).map(|plans| json!({"plans":plans}))
        }
        ("POST", ["api", "projects", project_id, "plans"]) => {
            create_plan(db, project_id, body).map(|plan| json!({"plan":plan}))
        }
        ("GET", ["api", "projects", project_id, "plans", plan_id]) => {
            plan(db, project_id, plan_id).map(|plan| json!({"plan":plan}))
        }
        ("PATCH", ["api", "projects", project_id, "plans", plan_id]) => {
            update_plan(db, project_id, plan_id, body).map(|plan| json!({"plan":plan}))
        }
        ("DELETE", ["api", "projects", project_id, "plans", plan_id]) => {
            delete_plan(db, project_id, plan_id)
        }
        ("POST", ["api", "projects", project_id, "plans", plan_id, "activate"]) => {
            activate(db, project_id, plan_id).map(|plan| json!({"plan":plan}))
        }
        ("GET", ["api", "projects", project_id, "plans", plan_id, "drafts"]) => {
            list_drafts(db, project_id, plan_id).map(|drafts| json!({"drafts":drafts}))
        }
        ("GET", ["api", "projects", project_id, "drafts", draft_id]) => {
            draft(db, project_id, draft_id).map(|draft| json!({"draft":draft}))
        }
        ("PATCH", ["api", "projects", project_id, "drafts", draft_id]) => {
            update_draft(db, project_id, draft_id, body).map(|draft| json!({"draft":draft}))
        }
        ("DELETE", ["api", "projects", project_id, "drafts", draft_id]) => {
            delete_draft(db, project_id, draft_id)
        }
        ("GET", ["api", "projects", project_id, "issues"]) => {
            list_issues(db, project_id, path).map(|issues| json!({"issues":issues}))
        }
        ("GET", ["api", "projects", project_id, "issues", issue_id]) => {
            issue(db, project_id, issue_id).map(|issue| json!({"issue":issue}))
        }
        ("PATCH", ["api", "projects", project_id, "issues", issue_id]) => {
            update_issue(db, project_id, issue_id, body).map(|issue| json!({"issue":issue}))
        }
        _ => return None,
    };
    Some(result)
}

fn project(db: &Connection, project_id: &str) -> Result<()> {
    one(
        db,
        "SELECT id FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    Ok(())
}

fn parse_json(value: &Value, field: &str, fallback: Value) -> Value {
    serde_json::from_str(value[field].as_str().unwrap_or("")).unwrap_or(fallback)
}

fn plan_view(mut row: Value, draft_count: i64, first: i64) -> Value {
    row["outline"] = parse_json(&row, "outlineJson", json!([]));
    row["firstChapterNumber"] = json!(first);
    if let Some(items) = row["outline"].as_array_mut() {
        for item in items { item["chapterNumber"] = json!(first + item["index"].as_i64().unwrap_or(1) - 1); item["title"] = json!(crate::chapter_titles::display_title(&item["title"])); }
    }
    row["relatedThreads"] = parse_json(&row, "relatedThreadsJson", json!([]));
    row["draftCount"] = json!(draft_count);
    for field in ["outlineJson", "relatedThreadsJson"] {
        row.as_object_mut().unwrap().remove(field);
    }
    row
}

pub(crate) fn plan(db: &Connection, project_id: &str, plan_id: &str) -> Result<Value> {
    let row = one(
        db,
        "SELECT * FROM ContinuationPlan WHERE id=? AND projectId=?",
        &[json!(plan_id), json!(project_id)],
    )?;
    let count = query(
        db,
        "SELECT COUNT(*) AS count FROM DraftChapter WHERE planId=?",
        &[json!(plan_id)],
    )?[0]["count"]
        .as_i64()
        .unwrap_or(0);
    Ok(plan_view(row, count, crate::chapter_titles::plan_first(db, plan_id)?))
}

fn list_plans(db: &Connection, project_id: &str) -> Result<Vec<Value>> {
    project(db, project_id)?;
    let counts=query(db,"SELECT planId,COUNT(*) AS count FROM DraftChapter WHERE projectId=? AND planId IS NOT NULL GROUP BY planId",
        &[json!(project_id)])?.into_iter().filter_map(|row|Some((row["planId"].as_str()?.to_string(),row["count"].as_i64()?)))
        .collect::<HashMap<_,_>>();
    Ok(query(db,"SELECT * FROM ContinuationPlan WHERE projectId=? ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,createdAt DESC",
        &[json!(project_id)])?.into_iter().map(|row|{
            let count=counts.get(row["id"].as_str().unwrap_or("")).copied().unwrap_or(0);
            let first = crate::chapter_titles::plan_first(db, row["id"].as_str().unwrap_or(""))?;
            Ok(plan_view(row,count,first))
        }).collect::<Result<Vec<_>>>()?)
}

fn text(body: &Value, field: &str, max: usize) -> Result<String> {
    let value = body[field]
        .as_str()
        .ok_or_else(|| format!("字段格式无效：{field}"))?
        .trim();
    if value.encode_utf16().count() > max {
        return Err(format!("字段过长：{field}"));
    }
    Ok(value.into())
}

fn create_plan(db: &mut Connection, project_id: &str, body: &Value) -> Result<Value> {
    project(db, project_id)?;
    let summary = text(body, "summary", 10000)?;
    if summary.is_empty() {
        return Err("请填写方向说明。".into());
    }
    let name = body["direction"].as_str().unwrap_or("").trim();
    if name.encode_utf16().count() > 300 {
        return Err("方向名称最多 300 字。".into());
    }
    let direction = if name.is_empty() {
        summary
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(30)
            .collect::<String>()
    } else {
        name.into()
    };
    let related = if let Some(source_id) = body["sourcePlanId"].as_str() {
        let source = one(
            db,
            "SELECT relatedThreadsJson FROM ContinuationPlan WHERE id=? AND projectId=?",
            &[json!(source_id), json!(project_id)],
        )?;
        source["relatedThreadsJson"]
            .as_str()
            .unwrap_or("[]")
            .to_string()
    } else {
        "[]".into()
    };
    let selected = body["select"] == true;
    let plan_id = id();
    let tx = db.transaction().map_err(|e| e.to_string())?;
    if selected {
        execute(&tx,"UPDATE ContinuationPlan SET status='draft',updatedAt=? WHERE projectId=? AND status='active'",
        &[json!(now()),json!(project_id)])?;
    }
    execute(&tx,"INSERT INTO ContinuationPlan(id,projectId,direction,summary,outlineJson,relatedThreadsJson,status,version,createdAt,updatedAt) VALUES(?,?,?,?,'[]',?,?,1,?,?)",
        &[json!(plan_id),json!(project_id),json!(direction),json!(summary),json!(related),
            json!(if selected{"active"}else{"draft"}),json!(now()),json!(now())])?;
    tx.commit().map_err(|e| e.to_string())?;
    plan(db, project_id, &plan_id)
}

fn normalize_outline(raw: &Value) -> Result<Value> {
    let rows = if let Some(rows) = raw.as_array() {
        rows.clone()
    } else if let Some(text) = raw.as_str() {
        serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    } else {
        return Err("章纲格式无效。".into());
    };
    if rows.len() > 1000 {
        return Err("章纲条目过多。".into());
    }
    let mut clean = Vec::new();
    for item in rows {
        if item["title"].as_str().unwrap_or("").trim().is_empty() {
            continue;
        }
        let title = crate::chapter_titles::display_title(&item["title"]);
        if title.encode_utf16().count() > 200 {
            return Err("章纲标题过长。".into());
        }
        let summary = item["summary"].as_str().unwrap_or("").trim();
        if summary.encode_utf16().count() > 10000 {
            return Err("章纲内容过长。".into());
        }
        let strings = |field: &str| -> Vec<String> {
            item[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .take(100)
                .map(str::to_string)
                .collect()
        };
        clean.push(
            json!({"index":clean.len()+1,"title":title,"summary":summary,
            "beats":strings("beats"),"relatedThreads":strings("relatedThreads")}),
        );
    }
    Ok(json!(clean))
}

pub fn update_plan(
    db: &mut Connection,
    project_id: &str,
    plan_id: &str,
    body: &Value,
) -> Result<Value> {
    let current = plan(db, project_id, plan_id)?;
    if let Some(expected) = body["expectedVersion"].as_i64() {
        if current["version"] != expected {
            return Err("该方向已发生变化，请刷新后重新编辑。".into());
        }
    }
    let direction = if body.get("direction").is_some() {
        let value = text(body, "direction", 300)?;
        if value.is_empty() {
            return Err("方向说明不能为空。".into());
        }
        value
    } else {
        current["direction"].as_str().unwrap_or("").into()
    };
    let summary = if body.get("summary").is_some() {
        if body["summary"].is_null() {
            None
        } else {
            let value = text(body, "summary", 10000)?;
            if value.is_empty() {
                return Err("方向说明不能为空。".into());
            }
            Some(value)
        }
    } else {
        current["summary"].as_str().map(str::to_string)
    };
    let changed = current["direction"] != direction || current["summary"] != json!(summary);
    if changed
        && (current["outline"]
            .as_array()
            .is_some_and(|rows| !rows.is_empty())
            || current["draftCount"].as_i64().unwrap_or(0) > 0)
    {
        return Err("该方向已有章纲或草稿，请另存为新方向。".into());
    }
    let outline = if let Some(raw) = body.get("outline") {
        normalize_outline(raw)?
    } else {
        normalize_outline(&current["outline"])?
    };
    let related = if let Some(raw) = body.get("relatedThreads") {
        let value = if let Some(text) = raw.as_str() {
            serde_json::from_str::<Value>(text).unwrap_or(json!([]))
        } else {
            raw.clone()
        };
        let rows = value.as_array().ok_or("关联线索格式无效。")?;
        json!(rows
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .take(100)
            .collect::<Vec<_>>())
    } else {
        current["relatedThreads"].clone()
    };
    let selected = body["select"] == true;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    if selected {
        execute(&tx,"UPDATE ContinuationPlan SET status='draft',updatedAt=? WHERE projectId=? AND id<>? AND status='active'",
        &[json!(now()),json!(project_id),json!(plan_id)])?;
    }
    let status = if selected {
        "active"
    } else {
        current["status"].as_str().unwrap_or("draft")
    };
    let material = changed
        || outline != normalize_outline(&current["outline"])?
        || related != current["relatedThreads"]
        || selected;
    if outline.as_array().is_some_and(|rows| !rows.is_empty()) {
        crate::chapter_titles::save_plan(&tx, plan_id, current["firstChapterNumber"].as_i64().unwrap_or(1))?;
    }
    if material {
        execute(&tx,"UPDATE ContinuationPlan SET direction=?,summary=?,outlineJson=?,relatedThreadsJson=?,status=?,version=version+1,updatedAt=? WHERE id=?",
        &[json!(direction),json!(summary),json!(outline.to_string()),json!(related.to_string()),json!(status),json!(now()),json!(plan_id)])?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    plan(db, project_id, plan_id)
}

fn activate(db: &mut Connection, project_id: &str, plan_id: &str) -> Result<Value> {
    plan(db, project_id, plan_id)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(&tx,"UPDATE ContinuationPlan SET status='draft',updatedAt=? WHERE projectId=? AND status='active' AND id<>?",
        &[json!(now()),json!(project_id),json!(plan_id)])?;
    execute(
        &tx,
        "UPDATE ContinuationPlan SET status='active',updatedAt=? WHERE id=?",
        &[json!(now()), json!(plan_id)],
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    plan(db, project_id, plan_id)
}

fn delete_plan(db: &mut Connection, project_id: &str, plan_id: &str) -> Result<Value> {
    plan(db, project_id, plan_id)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(
        &tx,
        "DELETE FROM DraftChapter WHERE projectId=? AND planId=?",
        &[json!(project_id), json!(plan_id)],
    )?;
    execute(
        &tx,
        "DELETE FROM ContinuationPlan WHERE id=?",
        &[json!(plan_id)],
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"deleted":true}))
}

fn draft_view(db: &Connection, mut row: Value) -> Result<Value> {
    row["chapterNumber"] = json!(crate::chapter_titles::draft_number(db, &row)?);
    row["title"] = json!(crate::chapter_titles::display_title(&row["title"]));
    row["outlineItem"] = parse_json(&row, "outlineItemJson", Value::Null);
    row["continuityCheckedAt"] =
        parse_json(&row, "continuityCheckJson", json!({}))["checkedAt"].clone();
    for field in ["outlineItemJson", "continuityCheckJson"] {
        row.as_object_mut().unwrap().remove(field);
    }
    Ok(row)
}

fn draft(db: &Connection, project_id: &str, draft_id: &str) -> Result<Value> {
    let row = one(
        db,
        "SELECT * FROM DraftChapter WHERE id=? AND projectId=?",
        &[json!(draft_id), json!(project_id)],
    )?;
    draft_view(db, row)
}

fn list_drafts(db: &Connection, project_id: &str, plan_id: &str) -> Result<Vec<Value>> {
    plan(db, project_id, plan_id)?;
    Ok(query(
        db,
        "SELECT * FROM DraftChapter WHERE projectId=? AND planId=? ORDER BY \"index\"",
        &[json!(project_id), json!(plan_id)],
    )?
    .into_iter()
    .map(|row| draft_view(db, row))
    .collect::<Result<Vec<_>>>()?)
}

fn update_draft(
    db: &mut Connection,
    project_id: &str,
    draft_id: &str,
    body: &Value,
) -> Result<Value> {
    let current = draft(db, project_id, draft_id)?;
    if body.get("expectedVersion").is_some() && body["expectedVersion"] != current["version"] {
        return Err("正文已更新，请重新打开本章后编辑。".into());
    }
    let title = if body.get("title").is_some() {
        if body["title"].is_null() {
            None
        } else {
            let value = crate::chapter_titles::clean(&text(body, "title", 200)?);
            (!value.is_empty()).then_some(value)
        }
    } else {
        current["title"].as_str().map(str::to_string)
    };
    let content = if body.get("content").is_some() {
        let value = text(body, "content", 200000)?;
        if value.is_empty() {
            return Err("草稿正文不能为空。".into());
        }
        value
    } else {
        current["content"].as_str().unwrap_or("").into()
    };
    let changed = body.get("content").is_some();
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(&tx,"UPDATE DraftChapter SET title=?,content=?,version=version+1,memoryUpdateStatus=?,updatedAt=? WHERE id=?",
        &[json!(title),json!(content),json!(if changed{"none"}else{current["memoryUpdateStatus"].as_str().unwrap_or("none")}),
            json!(now()),json!(draft_id)])?;
    if changed {
        invalidate_draft_checks(&tx, project_id, draft_id, current["planId"].as_str())?;
        execute(
            &tx,
            "DELETE FROM MemoryProposal WHERE draftId=? AND state='pending'",
            &[json!(draft_id)],
        )?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    draft(db, project_id, draft_id)
}

fn delete_draft(db: &Connection, project_id: &str, draft_id: &str) -> Result<Value> {
    let current = draft(db, project_id, draft_id)?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    invalidate_draft_checks(&tx, project_id, draft_id, current["planId"].as_str())?;
    execute(
        &tx,
        "DELETE FROM DraftChapter WHERE id=?",
        &[json!(draft_id)],
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"deleted":true}))
}

fn issue_view(mut row: Value) -> Value {
    row["evidence"] = parse_json(&row, "evidenceJson", json!([]));
    row.as_object_mut().unwrap().remove("evidenceJson");
    row
}

fn issue(db: &Connection, project_id: &str, issue_id: &str) -> Result<Value> {
    let row = one(
        db,
        "SELECT * FROM ContinuityIssue WHERE id=? AND projectId=?",
        &[json!(issue_id), json!(project_id)],
    )?;
    Ok(issue_view(row))
}

fn list_issues(db: &Connection, project_id: &str, path: &str) -> Result<Vec<Value>> {
    project(db, project_id)?;
    let draft_id = path.split_once('?').and_then(|(_, q)| {
        url::form_urlencoded::parse(q.as_bytes())
            .find(|(key, _)| key == "draftId")
            .map(|(_, value)| value.into_owned())
    });
    Ok(query(db,"SELECT * FROM ContinuityIssue WHERE projectId=? AND (? IS NULL OR draftId=?) ORDER BY severity DESC,createdAt",
        &[json!(project_id),json!(draft_id),json!(draft_id)])?.into_iter().map(issue_view).collect())
}

fn update_issue(db: &Connection, project_id: &str, issue_id: &str, body: &Value) -> Result<Value> {
    issue(db, project_id, issue_id)?;
    let status = body["status"].as_str().ok_or("未知的问题状态。")?;
    if !["open", "accepted", "ignored", "resolved"].contains(&status) {
        return Err("未知的问题状态。".into());
    }
    execute(
        db,
        "UPDATE ContinuityIssue SET status=?,updatedAt=? WHERE id=?",
        &[json!(status), json!(now()), json!(issue_id)],
    )?;
    issue(db, project_id, issue_id)
}

pub(crate) fn invalidate_checks(db: &Connection, project: &str, plan: &str) -> Result<()> {
    execute(db, "DELETE FROM ContinuityIssue WHERE draftId IN (SELECT id FROM DraftChapter WHERE projectId=? AND planId=?)", &[json!(project),json!(plan)])?;
    execute(
        db,
        "UPDATE DraftChapter SET continuityCheckJson='{}' WHERE projectId=? AND planId=?",
        &[json!(project), json!(plan)],
    )?;
    Ok(())
}

fn invalidate_draft_checks(
    db: &Connection,
    project: &str,
    draft: &str,
    plan: Option<&str>,
) -> Result<()> {
    if let Some(plan) = plan {
        return invalidate_checks(db, project, plan);
    }
    // 恢复旧备份时可能有未关联方向的草稿，仍允许作者编辑或删除。
    execute(
        db,
        "DELETE FROM ContinuityIssue WHERE projectId=? AND draftId=?",
        &[json!(project), json!(draft)],
    )?;
    execute(
        db,
        "UPDATE DraftChapter SET continuityCheckJson='{}' WHERE projectId=? AND id=?",
        &[json!(project), json!(draft)],
    )?;
    Ok(())
}
