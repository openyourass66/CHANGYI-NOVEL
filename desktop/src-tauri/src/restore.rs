use crate::database::{self, execute, id, now, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path};

fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn string(v: &Value, key: &str, default: &str, max: usize) -> Value {
    json!(v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .chars()
        .take(max)
        .collect::<String>())
}
fn number(v: &Value, key: &str, default: i64) -> Value {
    json!(v[key].as_i64().unwrap_or(default))
}
fn optional(v: &Value, key: &str) -> Value {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| json!(s))
        .unwrap_or(Value::Null)
}
fn mapped(v: &Value, key: &str, map: &HashMap<String, String>) -> Value {
    v[key]
        .as_str()
        .and_then(|s| map.get(s))
        .map(|s| json!(s))
        .unwrap_or(Value::Null)
}

fn insert(
    db: &Connection,
    table: &str,
    project_id: &str,
    fields: &[(&str, Value)],
) -> Result<String> {
    let row_id = id();
    let mut columns = vec!["id", "projectId", "createdAt"];
    let mut values = vec![json!(row_id), json!(project_id), json!(now())];
    if table != "CharacterKnowledge" {
        columns.push("updatedAt");
        values.push(json!(now()));
    }
    for (column, value) in fields {
        columns.push(column);
        values.push(value.clone());
    }
    execute(
        db,
        &format!(
            "INSERT INTO {table}({}) VALUES({})",
            columns
                .iter()
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(","),
            vec!["?"; values.len()].join(",")
        ),
        &values,
    )?;
    Ok(row_id)
}

fn references(
    value: &Value,
    chapter: &HashMap<String, String>,
    entries: &HashMap<String, String>,
    drafts: &HashMap<String, String>,
    evidence: bool,
    dropped: &mut usize,
) -> Value {
    let mut out = Vec::new();
    for item in value.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        if !item.is_object() {
            *dropped += 1;
            continue;
        }
        let (field, map) = if !evidence {
            ("chapterId", chapter)
        } else {
            match item["kind"].as_str() {
                Some("chapter") => ("chapterId", chapter),
                Some("memory") => ("entryId", entries),
                Some("draft") => ("draftId", drafts),
                _ => continue,
            }
        };
        if let Some(replacement) = item[field].as_str().and_then(|s| map.get(s)) {
            let mut item = item.clone();
            item[field] = json!(replacement);
            out.push(item);
        } else {
            *dropped += 1;
        }
    }
    json!(serde_json::to_string(&out).unwrap())
}

pub fn restore(db: &mut Connection, root: &Path, input: &Value) -> Result<Value> {
    if !input.is_object() || input.get("app").is_some_and(|v| v != "novel-continuation") {
        return Err("这不是本应用导出的备份文件。".into());
    }
    if !matches!(input["exportVersion"].as_i64(), Some(1 | 2)) {
        return Err("不支持的备份版本。".into());
    }
    let base = input["project"]["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("备份缺少项目名称。")?
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    let mut name = base.clone();
    let mut n = 1;
    while !query(
        db,
        "SELECT id FROM NovelProject WHERE name=?",
        &[json!(name)],
    )?
    .is_empty()
    {
        name = if n == 1 {
            format!("{base}（恢复）")
        } else {
            format!("{base}（恢复 {n}）")
        };
        n += 1;
    }
    for key in [
        "chapters",
        "memoryEntries",
        "characterKnowledge",
        "continuationPlans",
        "draftChapters",
        "continuityIssues",
        "memoryProposals",
    ] {
        if array(input, key).len() > 100000 {
            return Err("备份记录数量过多。".into());
        }
        if array(input, key).iter().any(|v| !v.is_object()) {
            return Err("备份中存在无效记录。".into());
        }
    }
    let project_id = id();
    let directory = database::safe_path(root, &format!("projects/{project_id}"))?;
    let result = (|| -> Result<Value> {
        let tx = db.transaction().map_err(|e| e.to_string())?;
        execute(&tx,"INSERT INTO NovelProject(id,name,language,genre,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",&[json!(project_id),json!(name),string(&input["project"],"language","zh",20),optional(&input["project"],"genre"),json!(now()),json!(now())])?;
        let content = array(input, "chapters")
            .iter()
            .map(|c| c["content"].as_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n\n");
        if content.len() > 200 * 1024 * 1024 {
            return Err("备份正文过大。".into());
        }
        let source_id = id();
        if !array(input, "chapters").is_empty() {
            fs::create_dir_all(directory.join("sources")).map_err(|e| e.to_string())?;
            let stored = format!("projects/{project_id}/sources/restored.txt");
            fs::write(database::safe_path(root, &stored)?, content.as_bytes())
                .map_err(|e| e.to_string())?;
            execute(&tx,"INSERT INTO SourceDocument(id,projectId,fileName,format,storedPath,contentHash,encoding,byteSize,importedAt) VALUES(?,?,?,'txt',?,?,'UTF-8',?,?)",&[json!(source_id),json!(project_id),json!(format!("{name}.txt")),json!(stored),json!(format!("{:x}",Sha256::digest(content.as_bytes()))),json!(content.len()),json!(now())])?;
        }
        let mut chapters = HashMap::new();
        let mut entries = HashMap::new();
        let mut plans = HashMap::new();
        let mut drafts = HashMap::new();
        let mut dropped = 0;
        let empty = HashMap::new();
        let mut cursor = 0;
        for (i, row) in array(input, "chapters").iter().enumerate() {
            let start = row["startOffset"].as_i64().unwrap_or(cursor);
            let end = row["endOffset"].as_i64().unwrap_or(
                start + row["content"].as_str().unwrap_or("").encode_utf16().count() as i64,
            );
            if start < 0 || end < start {
                return Err("备份中的章节定位无效。".into());
            }
            cursor = end + 2;
            let new_id = insert(
                &tx,
                "Chapter",
                &project_id,
                &[
                    ("sourceDocumentId", json!(source_id)),
                    ("volumeNumber", row["volumeNumber"].clone()),
                    ("volumeTitle", optional(row, "volumeTitle")),
                    (
                        "rawTitle",
                        string(row, "rawTitle", &format!("第 {} 章", i + 1), 300),
                    ),
                    (
                        "normalizedIndex",
                        number(row, "normalizedIndex", i as i64 + 1),
                    ),
                    ("content", string(row, "content", "", usize::MAX)),
                    ("startOffset", json!(start)),
                    ("endOffset", json!(end)),
                    ("sortOrder", number(row, "sortOrder", i as i64 + 1)),
                    ("splitMethod", string(row, "splitMethod", "auto", 20)),
                    (
                        "parseConfidence",
                        row.get("parseConfidence")
                            .filter(|v| v.is_number())
                            .cloned()
                            .unwrap_or(json!(1)),
                    ),
                    ("flagsJson", json!(json!(array(row, "flags")).to_string())),
                    (
                        "analysisStatus",
                        string(row, "analysisStatus", "pending", 20),
                    ),
                ],
            )?;
            if let Some(old) = row["id"].as_str() {
                if chapters.insert(old.to_string(), new_id).is_some() {
                    return Err("备份中的章节编号重复。".into());
                }
            }
        }
        let mut supersedes = Vec::new();
        for row in array(input, "memoryEntries") {
            let new_id = insert(
                &tx,
                "MemoryEntry",
                &project_id,
                &[
                    ("category", string(row, "category", "chapter-note", 40)),
                    ("key", optional(row, "key")),
                    ("title", optional(row, "title")),
                    ("content", string(row, "content", "", usize::MAX)),
                    ("status", string(row, "status", "unknown", 20)),
                    (
                        "sourceCitationsJson",
                        references(
                            &row["citations"],
                            &chapters,
                            &empty,
                            &empty,
                            false,
                            &mut dropped,
                        ),
                    ),
                    ("isUserEdited", json!(row["isUserEdited"] == true)),
                    ("revision", number(row, "revision", 1)),
                    ("isCurrent", json!(row["isCurrent"] != false)),
                ],
            )?;
            if let Some(old) = row["id"].as_str() {
                if entries.insert(old.to_string(), new_id.clone()).is_some() {
                    return Err("备份中的记忆编号重复。".into());
                }
            }
            if let Some(old) = row["supersedesId"].as_str() {
                supersedes.push((new_id, old.to_string()));
            }
        }
        for (new_id, old) in supersedes {
            if let Some(previous) = entries.get(&old) {
                execute(
                    &tx,
                    "UPDATE MemoryEntry SET supersedesId=? WHERE id=?",
                    &[json!(previous), json!(new_id)],
                )?;
            }
        }
        for row in array(input, "characterKnowledge") {
            insert(
                &tx,
                "CharacterKnowledge",
                &project_id,
                &[
                    (
                        "characterName",
                        string(row, "characterName", "（未知）", 120),
                    ),
                    ("infoItem", string(row, "infoItem", "", usize::MAX)),
                    ("relation", string(row, "relation", "known", 20)),
                ],
            )?;
        }
        for row in array(input, "continuationPlans") {
            let new_id = insert(
                &tx,
                "ContinuationPlan",
                &project_id,
                &[
                    ("direction", string(row, "direction", "（未命名方向）", 300)),
                    ("summary", optional(row, "summary")),
                    (
                        "outlineJson",
                        json!(json!(array(row, "outline")).to_string()),
                    ),
                    (
                        "relatedThreadsJson",
                        json!(json!(array(row, "relatedThreads")).to_string()),
                    ),
                    ("status", string(row, "status", "draft", 20)),
                    ("version", number(row, "version", 1)),
                ],
            )?;
            if let Some(first) = row["firstChapterNumber"].as_i64().filter(|n| *n > 0) { crate::chapter_titles::save_plan(&tx, &new_id, first)?; }
            if let Some(old) = row["id"].as_str() {
                if plans.insert(old.to_string(), new_id).is_some() {
                    return Err("备份中的方向编号重复。".into());
                }
            }
        }
        for row in array(input, "draftChapters") {
            let new_id = insert(
                &tx,
                "DraftChapter",
                &project_id,
                &[
                    ("planId", mapped(row, "planId", &plans)),
                    ("index", number(row, "index", 1)),
                    ("title", optional(row, "title")),
                    ("content", string(row, "content", "", usize::MAX)),
                    (
                        "outlineItemJson",
                        json!(row
                            .get("outlineItem")
                            .filter(|v| v.is_object())
                            .unwrap_or(&json!({}))
                            .to_string()),
                    ),
                    ("version", number(row, "version", 1)),
                    (
                        "continuityCheckJson",
                        json!(row
                            .get("continuityCheck")
                            .filter(|v| v.is_object())
                            .unwrap_or(&json!({}))
                            .to_string()),
                    ),
                    (
                        "memoryUpdateStatus",
                        string(row, "memoryUpdateStatus", "none", 20),
                    ),
                ],
            )?;
            if let Some(old) = row["id"].as_str() {
                if drafts.insert(old.to_string(), new_id).is_some() {
                    return Err("备份中的草稿编号重复。".into());
                }
            }
        }
        for row in array(input, "continuityIssues") {
            insert(
                &tx,
                "ContinuityIssue",
                &project_id,
                &[
                    ("draftId", mapped(row, "draftId", &drafts)),
                    ("category", string(row, "category", "其他", 40)),
                    ("severity", string(row, "severity", "info", 20)),
                    ("description", string(row, "description", "", usize::MAX)),
                    (
                        "evidenceJson",
                        references(
                            &row["evidence"],
                            &chapters,
                            &entries,
                            &drafts,
                            true,
                            &mut dropped,
                        ),
                    ),
                    ("status", string(row, "status", "open", 20)),
                ],
            )?;
        }
        for row in array(input, "memoryProposals") {
            insert(
                &tx,
                "MemoryProposal",
                &project_id,
                &[
                    ("chapterId", mapped(row, "chapterId", &chapters)),
                    ("draftId", mapped(row, "draftId", &drafts)),
                    ("kind", string(row, "kind", "add", 20)),
                    ("category", string(row, "category", "chapter-note", 40)),
                    ("key", optional(row, "key")),
                    ("title", optional(row, "title")),
                    ("content", string(row, "content", "", usize::MAX)),
                    ("status", string(row, "status", "inferred", 20)),
                    (
                        "citationsJson",
                        references(
                            &row["citations"],
                            &chapters,
                            &empty,
                            &empty,
                            false,
                            &mut dropped,
                        ),
                    ),
                    ("targetEntryId", mapped(row, "targetEntryId", &entries)),
                    ("reason", optional(row, "reason")),
                    ("state", string(row, "state", "pending", 20)),
                ],
            )?;
        }
        let project = one(
            &tx,
            "SELECT * FROM NovelProject WHERE id=?",
            &[json!(project_id)],
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(
            json!({"project":project,"summary":{"chapterCount":array(input,"chapters").len(),"memoryCount":array(input,"memoryEntries").len(),"droppedCitations":dropped}}),
        )
    })();
    if result.is_err() && directory.exists() {
        let _ = fs::remove_dir_all(directory);
    }
    result
}
