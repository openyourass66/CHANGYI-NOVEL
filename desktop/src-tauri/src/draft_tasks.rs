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
    let ctx = context::build(db, project_id, if check { 3 } else { 1 })?;
    let memories=query(db,"SELECT * FROM MemoryEntry WHERE projectId=? AND isCurrent=1 ORDER BY category,updatedAt DESC",
        &[json!(project_id)])?;
    let mut refs = HashMap::new();
    let mut lines = Vec::new();
    let mut used = 0;
    for row in memories {
        let reference = format!("M{}", lines.len() + 1);
        let line = format!(
            "[{reference}] {}｜{}（{}）：{}",
            row["category"].as_str().unwrap_or(""),
            row["title"]
                .as_str()
                .or_else(|| row["key"].as_str())
                .unwrap_or("（无标题）"),
            row["status"].as_str().unwrap_or(""),
            row["content"].as_str().unwrap_or("")
        );
        let len = line.encode_utf16().count();
        if used + len > 12000 {
            break;
        }
        used += len;
        refs.insert(reference, row["id"].clone());
        lines.push(line);
    }
    let system = if check {
        "你是一名小说编辑，核对续写草稿与既有事实是否自洽。只报告明确的事实冲突或内部矛盾，不提风格建议。每个问题必须给出逐字出现的草稿片段，相关记忆使用 M1、M2 等编号引用。没有把握就不报告。"
    } else {
        "你是一名小说编辑，从续写草稿提取相对已有记忆的新事实或变化。唯一依据是草稿与既有记忆，不得编造；已存在的同一条目沿用其标题作为 key；一条一事。不重复未变化的既有事实。"
    };
    let format = if check {
        r#"{"issues":[{"category":"时间|因果|设定|人物认知|视角|顺序|其他","severity":"info|warning|error","description":string,"draftExcerpts":[string],"memoryRefs":[string]}]}"#
    } else {
        r#"{"items":[{"category":"chapter-note|character|story-bible|timeline|thread|glossary","key":string,"title":string,"content":string,"state":"open|advanced|resolved|uncertain"}]}"#
    };
    let prompt=format!("{}\n\n【可引用的记忆编号】\n{}\n\n【本章章纲】\n{}\n\n【续写草稿：第 {} 章《{}》】\n{}\n\n只返回 JSON：{}。{}",
        ctx.text,lines.join("\n"),draft["outlineItemJson"].as_str().unwrap_or("{}"),
        draft["index"],draft["title"].as_str().unwrap_or("（无标题）"),draft["content"].as_str().unwrap_or(""),
        format,if check{"最多 12 个问题，未发现冲突时 issues 为空数组。"}else{"最多 20 条。非悬念条目将标为推断，作者确认后才写入记忆。没有变化时 items 为空数组。"});
    let (output, usage) = model::request_json(
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
                let content = draft["content"].as_str().unwrap_or("");
                let mut reference = json!({"kind":"draft","draftId":draft_id,"excerpt":excerpt.chars().take(200).collect::<String>()});
                if let Some(offset) = content.find(&excerpt) {
                    let start = content[..offset].encode_utf16().count();
                    reference["startOffset"] = json!(start);
                    reference["endOffset"] = json!(start + excerpt.encode_utf16().count());
                }
                evidence.push(reference);
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
            "promptVersion":"continuity-check@1","issueCount":clean.len()});
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
