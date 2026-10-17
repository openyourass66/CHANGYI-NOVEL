use crate::database::{execute, id, now, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn route(
    db: &mut Connection,
    method: &str,
    parts: &[&str],
    path: &str,
) -> Option<Result<Value>> {
    let result = match (method, parts) {
        ("GET", ["api", "projects", project_id, "proposals"]) => list(db, project_id, path),
        ("POST", ["api", "projects", project_id, "proposals", "accept-all"]) => {
            accept_all(db, project_id)
        }
        ("POST", ["api", "proposals", proposal_id, "accept"]) => accept(db, proposal_id),
        ("POST", ["api", "proposals", proposal_id, "reject"]) => reject(db, proposal_id),
        _ => return None,
    };
    Some(result)
}

fn exists_project(db: &Connection, project_id: &str) -> Result<()> {
    one(
        db,
        "SELECT id FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    Ok(())
}

fn proposal(db: &Connection, proposal_id: &str) -> Result<Value> {
    one(
        db,
        "SELECT * FROM MemoryProposal WHERE id=?",
        &[json!(proposal_id)],
    )
}

fn labels(db: &Connection, project_id: &str) -> Result<HashMap<String, (String, usize)>> {
    Ok(query(
        db,
        "SELECT id,rawTitle FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?
    .into_iter()
    .enumerate()
    .filter_map(|(i, row)| {
        Some((
            row["id"].as_str()?.to_string(),
            (row["rawTitle"].as_str()?.to_string(), i + 1),
        ))
    })
    .collect())
}

fn draft_labels(db: &Connection, project_id: &str) -> Result<HashMap<String, String>> {
    Ok(query(
        db,
        "SELECT id,\"index\",title FROM DraftChapter WHERE projectId=?",
        &[json!(project_id)],
    )?
    .into_iter()
    .filter_map(|row| {
        Some((
            row["id"].as_str()?.to_string(),
            format!(
                "第 {} 章 · {}",
                row["index"],
                row["title"].as_str().unwrap_or("（无标题）")
            ),
        ))
    })
    .collect())
}

fn view(
    row: Value,
    chapters: &HashMap<String, (String, usize)>,
    drafts: &HashMap<String, String>,
) -> Value {
    let citations: Vec<Value> =
        serde_json::from_str(row["citationsJson"].as_str().unwrap_or("[]")).unwrap_or_default();
    let citations: Vec<Value> = citations
        .into_iter()
        .filter_map(|mut citation| {
            let id = citation["chapterId"].as_str()?;
            let (title, index) = chapters
                .get(id)
                .cloned()
                .unwrap_or(("（章节已删除）".into(), 0));
            citation["chapterTitle"] = json!(title);
            citation["chapterIndex"] = json!(index);
            Some(citation)
        })
        .collect();
    let draft_label = row["draftId"]
        .as_str()
        .map(|id| drafts.get(id).cloned().unwrap_or("（草稿已删除）".into()));
    json!({
        "id":row["id"],"runId":row["runId"],"chapterId":row["chapterId"],"draftId":row["draftId"],
        "draftLabel":draft_label,"kind":row["kind"],"category":row["category"],"key":row["key"],
        "title":row["title"],"content":row["content"],"status":row["status"],"citations":citations,
        "targetEntryId":row["targetEntryId"],"reason":row["reason"],"state":row["state"],
        "createdAt":row["createdAt"]
    })
}

fn view_one(db: &Connection, proposal_id: &str) -> Result<Value> {
    let row = proposal(db, proposal_id)?;
    let project_id = row["projectId"]
        .as_str()
        .ok_or("提案项目无效。")?
        .to_string();
    Ok(view(
        row,
        &labels(db, &project_id)?,
        &draft_labels(db, &project_id)?,
    ))
}

fn list(db: &Connection, project_id: &str, path: &str) -> Result<Value> {
    exists_project(db, project_id)?;
    let state = path.split_once('?').and_then(|(_, params)| {
        url::form_urlencoded::parse(params.as_bytes())
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.into_owned())
    });
    let state = state.filter(|value| {
        ["pending", "accepted", "rejected", "conflicted"].contains(&value.as_str())
    });
    let rows = query(db, "SELECT * FROM MemoryProposal WHERE projectId=? AND (? IS NULL OR state=?) ORDER BY createdAt DESC",
        &[json!(project_id), json!(state), json!(state)])?;
    let chapters = labels(db, project_id)?;
    let drafts = draft_labels(db, project_id)?;
    let counts: serde_json::Map<String, Value> = query(
        db,
        "SELECT state,COUNT(*) AS count FROM MemoryProposal WHERE projectId=? GROUP BY state",
        &[json!(project_id)],
    )?
    .into_iter()
    .filter_map(|row| Some((row["state"].as_str()?.to_string(), row["count"].clone())))
    .collect();
    Ok(
        json!({"proposals":rows.into_iter().map(|row| view(row, &chapters, &drafts)).collect::<Vec<_>>(),"counts":counts}),
    )
}

fn reconcile_draft(db: &Connection, draft_id: Option<&str>) -> Result<()> {
    let Some(draft_id) = draft_id else {
        return Ok(());
    };
    let rows = query(
        db,
        "SELECT state,COUNT(*) AS count FROM MemoryProposal WHERE draftId=? GROUP BY state",
        &[json!(draft_id)],
    )?;
    let mut counts = HashMap::new();
    for row in rows {
        if let Some(state) = row["state"].as_str() {
            counts.insert(state.to_string(), row["count"].as_i64().unwrap_or(0));
        }
    }
    let next = if counts.get("pending").copied().unwrap_or(0) > 0
        || counts.get("conflicted").copied().unwrap_or(0) > 0
    {
        "proposed"
    } else if counts.get("accepted").copied().unwrap_or(0) > 0 {
        "applied"
    } else {
        "none"
    };
    execute(
        db,
        "UPDATE DraftChapter SET memoryUpdateStatus=?,updatedAt=? WHERE id=?",
        &[json!(next), json!(now()), json!(draft_id)],
    )?;
    Ok(())
}

fn current_head(db: &Connection, target_id: &str, project_id: &str) -> Result<Value> {
    let mut row = one(
        db,
        "SELECT * FROM MemoryEntry WHERE id=?",
        &[json!(target_id)],
    )?;
    for _ in 0..1000 {
        if row["projectId"] != project_id {
            return Err("提案目标不属于当前项目。".into());
        }
        let children = query(
            db,
            "SELECT * FROM MemoryEntry WHERE supersedesId=? ORDER BY createdAt DESC LIMIT 1",
            &[row["id"].clone()],
        )?;
        let Some(child) = children.into_iter().next() else {
            return Ok(row);
        };
        row = child;
    }
    Err("记忆版本链过长或损坏。".into())
}

fn accept(db: &mut Connection, proposal_id: &str) -> Result<Value> {
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let row = proposal(&tx, proposal_id)?;
    if row["state"] != "pending" {
        return Ok(json!({"proposal":view_one(&tx, proposal_id)?}));
    }
    let project_id = row["projectId"].as_str().ok_or("提案项目无效。")?;
    let draft_id = row["draftId"].as_str();
    let at = now();
    let mut message = None::<String>;
    let target = row["targetEntryId"].as_str();
    if let Some(target_id) = target {
        let head = current_head(&tx, target_id, project_id)?;
        if head["isUserEdited"] == true {
            let reason = "目标条目已人工修改，需人工裁决。";
            execute(
                &tx,
                "UPDATE MemoryProposal SET state='conflicted',reason=?,updatedAt=? WHERE id=?",
                &[json!(reason), json!(at), json!(proposal_id)],
            )?;
            message = Some(reason.into());
        } else {
            let unchanged = ["category", "key", "title", "content", "status"]
                .iter()
                .all(|field| head[*field] == row[*field])
                && head["sourceCitationsJson"] == row["citationsJson"];
            if !unchanged {
                execute(
                    &tx,
                    "UPDATE MemoryEntry SET isCurrent=0 WHERE id=?",
                    &[head["id"].clone()],
                )?;
                execute(&tx,
                    "INSERT INTO MemoryEntry(id,projectId,category,key,title,content,status,sourceCitationsJson,isUserEdited,revision,isCurrent,supersedesId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,0,?,1,?,?,?)",
                    &[json!(id()),json!(project_id),row["category"].clone(),row["key"].clone(),row["title"].clone(),
                        row["content"].clone(),row["status"].clone(),row["citationsJson"].clone(),
                        json!(head["revision"].as_i64().unwrap_or(1)+1),head["id"].clone(),json!(at),json!(at)])?;
            }
        }
    } else {
        execute(&tx,
            "INSERT INTO MemoryEntry(id,projectId,category,key,title,content,status,sourceCitationsJson,isUserEdited,revision,isCurrent,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,0,1,1,?,?)",
            &[json!(id()),json!(project_id),row["category"].clone(),row["key"].clone(),row["title"].clone(),
                row["content"].clone(),row["status"].clone(),row["citationsJson"].clone(),json!(at),json!(at)])?;
    }
    if message.is_none() {
        execute(
            &tx,
            "UPDATE MemoryProposal SET state='accepted',updatedAt=? WHERE id=?",
            &[json!(at), json!(proposal_id)],
        )?;
    }
    reconcile_draft(&tx, draft_id)?;
    let response = json!({"proposal":view_one(&tx, proposal_id)?,"message":message});
    tx.commit().map_err(|e| e.to_string())?;
    Ok(response)
}

fn reject(db: &mut Connection, proposal_id: &str) -> Result<Value> {
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let row = proposal(&tx, proposal_id)?;
    if row["state"] == "accepted" {
        return Err("已采纳的提案不能忽略，请到记忆工作台编辑。".into());
    }
    execute(
        &tx,
        "UPDATE MemoryProposal SET state='rejected',updatedAt=? WHERE id=?",
        &[json!(now()), json!(proposal_id)],
    )?;
    reconcile_draft(&tx, row["draftId"].as_str())?;
    let response = json!({"proposal":view_one(&tx, proposal_id)?});
    tx.commit().map_err(|e| e.to_string())?;
    Ok(response)
}

fn accept_all(db: &mut Connection, project_id: &str) -> Result<Value> {
    exists_project(db, project_id)?;
    let pending = query(db,
        "SELECT id FROM MemoryProposal WHERE projectId=? AND state='pending' ORDER BY createdAt ASC",
        &[json!(project_id)])?;
    let mut accepted = 0;
    let mut conflicted = 0;
    for row in pending {
        let result = accept(db, row["id"].as_str().ok_or("提案编号无效。")?)?;
        match result["proposal"]["state"].as_str() {
            Some("accepted") => accepted += 1,
            Some("conflicted") => conflicted += 1,
            _ => {}
        }
    }
    Ok(json!({"accepted":accepted,"conflicted":conflicted}))
}
