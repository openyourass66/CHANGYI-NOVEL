use crate::{
    context,
    database::{execute, id, now, one, query, Result},
    model, proposals,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

fn strings(value: &Value, field: &str, limit: usize) -> Vec<String> {
    value[field]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .take(limit)
        .map(str::to_string)
        .collect()
}

pub fn run(
    db: &mut Connection,
    profile: &model::Profile,
    run_id: &str,
    project_id: &str,
    unit_id: &str,
    check: bool,
) -> Result<(usize, Value)> {
    let prefix = if check { "check-" } else { "memo-" };
    let draft_id = unit_id.strip_prefix(prefix).ok_or("草稿任务编号无效。")?;
    let draft = one(
        db,
        "SELECT * FROM DraftChapter WHERE id=? AND projectId=?",
        &[json!(draft_id), json!(project_id)],
    )?;
    let focus = format!(
        "{}\n{}\n{}",
        draft["title"], draft["outlineItemJson"], draft["content"]
    );
    let ctx = context::build_for(db, project_id, if check { 3 } else { 1 }, &focus)?;
    let history = context::draft_history(
        db,
        project_id,
        draft["planId"].as_str().ok_or("草稿方向无效。")?,
        draft["index"].as_i64().ok_or("草稿章序无效。")?,
        check,
        &focus,
    )?;
    let mut refs = HashMap::new();
    let mut lines = Vec::new();
    for row in &ctx.memories {
        let reference = format!("M{}", lines.len() + 1);
        lines.push(format!(
            "[{reference}] {}｜{}（{}）：{}",
            row["category"].as_str().unwrap_or(""),
            row["title"]
                .as_str()
                .or_else(|| row["key"].as_str())
                .unwrap_or("（无标题）"),
            row["status"].as_str().unwrap_or(""),
            row["content"].as_str().unwrap_or("")
        ));
        refs.insert(reference, row["id"].clone());
    }
    let system = if check {
        "你是一名小说编辑，核对续写草稿与既有事实是否自洽。只报告明确的事实冲突或内部矛盾，不提风格建议。每个问题必须给出逐字出现的草稿片段，相关记忆使用 M1、M2 等编号引用。也核对同方向其他续写正文，使用 D1、D2 等编号及逐字片段引用；注意章序和合理状态变化，后章变化不能直接视为前章矛盾。节选未覆盖的内容不能判定为已核对。没有把握就不报告。"
    } else {
        "你是一名小说编辑，从续写草稿提取相对已有记忆的新事实或变化。唯一依据是草稿与既有记忆，不得编造；已存在的同一条目沿用其标题作为 key；一条一事。参考此前续写正文，不重复已发生且未变化的事实。"
    };
    let format = if check {
        r#"{"issues":[{"category":"时间|因果|设定|人物认知|视角|顺序|其他","severity":"info|warning|error","description":string,"draftExcerpts":[string],"memoryRefs":[string],"draftRefs":[{"ref":"D1","excerpt":string}]}]}"#
    } else {
        r#"{"items":[{"category":"chapter-note|character|story-bible|timeline|thread|glossary","key":string,"title":string,"content":string,"state":"open|advanced|resolved|uncertain"}]}"#
    };
    let prompt=format!("{}\n\n【可引用的记忆编号】\n{}\n\n【同方向其他续写正文（带章序，可能节选）】\n{}\n\n【本章章纲】\n{}\n\n【续写草稿：第 {} 章《{}》】\n{}\n\n只返回 JSON：{}。{}",
        ctx.text,lines.join("\n"),history.text,draft["outlineItemJson"].as_str().unwrap_or("{}"),
        draft["index"],draft["title"].as_str().unwrap_or("（无标题）"),draft["content"].as_str().unwrap_or(""),
        format,if check{"最多 12 个问题，未发现冲突时 issues 为空数组。"}else{"最多 20 条。非悬念条目将标为推断，作者确认后才写入记忆。没有变化时 items 为空数组。"});
    let (output, usage) = model::request_tracked(
        db,
        run_id,
        profile,
        system,
        &prompt,
        4096,
        if check {
            "continuity-check"
        } else {
            "draft-memory"
        },
    )?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    if one(
        &tx,
        "SELECT status FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?["status"]
        == "canceled"
    {
        return Err("任务已取消。".into());
    }
    let current = one(
        &tx,
        "SELECT version,content FROM DraftChapter WHERE id=? AND projectId=?",
        &[json!(draft_id), json!(project_id)],
    )?;
    if current["version"] != draft["version"] || current["content"] != draft["content"] {
        return Err("草稿已修改，请重新运行。".into());
    }
    // 模型请求期间其他正文也可能被作者编辑，旧快照不能写成有效检查。
    let latest = context::draft_history(
        &tx,
        project_id,
        draft["planId"].as_str().unwrap_or(""),
        draft["index"].as_i64().unwrap_or(0),
        check,
        &focus,
    )?;
    if latest.drafts != history.drafts {
        return Err("同方向正文已修改，请重新运行。".into());
    }
    let count = if check {
        let issues = output["issues"]
            .as_array()
            .filter(|rows| rows.len() <= 12)
            .ok_or("连续性检查结果格式无效。")?;
        let mut clean = Vec::new();
        for item in issues {
            let category = item["category"]
                .as_str()
                .filter(|s| {
                    ["时间", "因果", "设定", "人物认知", "视角", "顺序", "其他"].contains(s)
                })
                .ok_or("连续性问题分类无效。")?;
            let severity = item["severity"]
                .as_str()
                .filter(|s| ["info", "warning", "error"].contains(s))
                .ok_or("连续性问题等级无效。")?;
            let description = item["description"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 600)
                .ok_or("连续性问题描述无效。")?;
            let mut evidence = Vec::new();
            for excerpt in strings(item, "draftExcerpts", 4) {
                if let Some(reference) = draft_evidence(&draft, &excerpt) {
                    evidence.push(reference);
                }
            }
            // 每个问题必须有本章逐字证据，拒绝虚构片段。
            if evidence.is_empty() {
                continue;
            }
            for reference in item["draftRefs"].as_array().into_iter().flatten() {
                let number = reference["ref"].as_str().unwrap_or("").to_uppercase();
                if let Some(row) = number
                    .strip_prefix('D')
                    .and_then(|n| n.parse::<usize>().ok())
                    .and_then(|n| n.checked_sub(1))
                    .and_then(|n| history.drafts.get(n))
                {
                    if let Some(reference) =
                        draft_evidence(row, reference["excerpt"].as_str().unwrap_or(""))
                    {
                        evidence.push(reference);
                    }
                }
            }
            for reference in strings(item, "memoryRefs", 6) {
                if let Some(entry_id) = refs.get(&reference.to_uppercase()) {
                    evidence.push(json!({"kind":"memory","entryId":entry_id}));
                }
            }
            clean.push((
                category.to_string(),
                severity.to_string(),
                description.to_string(),
                json!(evidence),
            ));
        }
        execute(
            &tx,
            "DELETE FROM ContinuityIssue WHERE draftId=?",
            &[json!(draft_id)],
        )?;
        for (category, severity, description, evidence) in &clean {
            execute(&tx,"INSERT INTO ContinuityIssue(id,projectId,draftId,category,severity,description,evidenceJson,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'open',?,?)",
                &[json!(id()),json!(project_id),json!(draft_id),json!(category),json!(severity),json!(description),
                    json!(evidence.to_string()),json!(now()),json!(now())])?;
        }
        let checked = json!({"checkedAt":chrono::Utc::now().to_rfc3339(),"runId":run_id,
            "promptVersion":"continuity-check@2","issueCount":clean.len()});
        execute(
            &tx,
            "UPDATE DraftChapter SET continuityCheckJson=?,updatedAt=? WHERE id=?",
            &[json!(checked.to_string()), json!(now()), json!(draft_id)],
        )?;
        clean.len()
    } else {
        let items = output["items"]
            .as_array()
            .filter(|rows| rows.len() <= 20)
            .ok_or("草稿记忆结果格式无效。")?;
        let mut clean = Vec::new();
        for item in items {
            let category = item["category"]
                .as_str()
                .filter(|s| {
                    [
                        "chapter-note",
                        "character",
                        "story-bible",
                        "timeline",
                        "thread",
                        "glossary",
                    ]
                    .contains(s)
                })
                .ok_or("草稿记忆分类无效。")?;
            let content = item["content"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 2000)
                .ok_or("草稿记忆内容无效。")?;
            let key = if category == "chapter-note" {
                Some(format!("draft:{draft_id}"))
            } else {
                item["key"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            let title = if category == "chapter-note" {
                Some(format!(
                    "草稿笔记：第 {} 章 · {}",
                    draft["index"],
                    draft["title"].as_str().unwrap_or("（无标题）")
                ))
            } else {
                item["title"]
                    .as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            if key.as_ref().is_some_and(|s| s.encode_utf16().count() > 120)
                || title
                    .as_ref()
                    .is_some_and(|s| s.encode_utf16().count() > 200)
            {
                return Err("草稿记忆标题或键过长。".into());
            }
            let state = if category == "thread" {
                match item["state"].as_str() {
                    Some("advanced") => "advanced",
                    Some("resolved") => "resolved",
                    Some("uncertain") => "uncertain",
                    _ => "open",
                }
            } else {
                "inferred"
            };
            clean.push((
                category.to_string(),
                key,
                title,
                content.to_string(),
                state.to_string(),
            ));
        }
        execute(
            &tx,
            "DELETE FROM MemoryProposal WHERE draftId=? AND state='pending'",
            &[json!(draft_id)],
        )?;
        for (category, key, title, content, state) in &clean {
            let existing = if let Some(key) = key {
                query(&tx,"SELECT id,isUserEdited FROM MemoryEntry WHERE projectId=? AND category=? AND key=? AND isCurrent=1 ORDER BY updatedAt DESC LIMIT 1",
                    &[json!(project_id),json!(category),json!(key)])?.into_iter().next()
            } else {
                None
            };
            let kind = if existing
                .as_ref()
                .is_some_and(|row| row["isUserEdited"] == true)
            {
                "conflict"
            } else if existing.is_some() {
                "update"
            } else {
                "add"
            };
            let target = existing
                .as_ref()
                .map(|row| row["id"].clone())
                .unwrap_or(Value::Null);
            execute(&tx,"INSERT INTO MemoryProposal(id,projectId,runId,draftId,kind,category,key,title,content,status,citationsJson,targetEntryId,reason,state,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,'[]',?,?,'pending',?,?)",
                &[json!(id()),json!(project_id),json!(run_id),json!(draft_id),json!(kind),json!(category),
                    json!(key),json!(title),json!(content),json!(state),target,
                    json!(if kind=="conflict"{Some("目标条目已人工修改，需人工裁决。")}else{None}),json!(now()),json!(now())])?;
        }
        proposals::reconcile_draft(&tx, Some(draft_id))?;
        clean.len()
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok((count, usage))
}

fn draft_evidence(row: &Value, excerpt: &str) -> Option<Value> {
    if excerpt.is_empty() {
        return None;
    }
    let content = row["content"].as_str()?;
    let offset = content.find(excerpt)?;
    let start = content[..offset].encode_utf16().count();
    Some(
        json!({"kind":"draft","draftId":row["id"],"excerpt":excerpt,"startOffset":start,"endOffset":start+excerpt.encode_utf16().count()}),
    )
}
