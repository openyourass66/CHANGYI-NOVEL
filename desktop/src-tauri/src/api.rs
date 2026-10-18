use crate::database::{self, execute, id, now, one, query, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::Path};

const MAX_FILE: usize = 50 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub body: Value,
}

#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: Value,
}

pub fn request(db: &mut Connection, root: &Path, request: ApiRequest) -> ApiResponse {
    match dispatch(db, root, &request) {
        Ok(body) => ApiResponse { status: 200, body },
        Err(message) => ApiResponse {
            status: 400,
            body: json!({ "error": message }),
        },
    }
}

pub fn dispatch(db: &mut Connection, root: &Path, req: &ApiRequest) -> Result<Value> {
    let parts: Vec<&str> = req
        .path
        .split('?')
        .next()
        .unwrap_or("")
        .trim_matches('/')
        .split('/')
        .collect();
    let body = &req.body;
    if let Some(result) = crate::automation::route(db, root, &req.method, &parts, body) {
        return result;
    }
    if req.method != "GET" {
        if let ["api", "chapters", chapter_id, ..] = parts.as_slice() {
            let chapter = one(
                db,
                "SELECT projectId FROM Chapter WHERE id=?",
                &[json!(chapter_id)],
            )?;
            if crate::automation::active(db, chapter["projectId"].as_str().ok_or("章节不存在。")?)?
            {
                return Err("自动流程正在运行，请先停止后再修改原文。".into());
            }
        }
        if let ["api", "projects", project_id, rest @ ..] = parts.as_slice() {
            if crate::automation::active(db, project_id)?
                && !matches!(rest, ["proposals", "accept-all"])
            {
                return Err("自动流程正在运行，请先停止后再修改项目内容。".into());
            }
        }
    }
    if let Some(result) = crate::memory::route(db, &req.method, &parts, &req.path, body) {
        return result;
    }
    if let Some(result) = crate::profiles::route(db, root, &req.method, &parts, body) {
        return result;
    }
    if let Some(result) = crate::proposals::route(db, &req.method, &parts, &req.path) {
        return result;
    }
    if let Some(result) = crate::analysis::route(db, root, &req.method, &parts, body) {
        return result;
    }
    if let Some(result) = crate::continuation::route(db, &req.method, &parts, &req.path, body) {
        return result;
    }
    match (req.method.as_str(), parts.as_slice()) {
        ("POST", ["api", "projects", "restore"]) => crate::restore::restore(db, root, body),
        ("GET", ["api", "projects"]) => Ok(json!({ "projects": list_projects(db)? })),
        ("POST", ["api", "projects"]) => {
            let name = text(body, "name", 1, 120)?;
            let genre = body["genre"].as_str().unwrap_or("").trim();
            let language = body["language"].as_str().unwrap_or("zh").trim();
            if language.is_empty() || language.chars().count() > 20 || genre.chars().count() > 40 {
                return Err("项目语言或体裁长度无效。".into());
            }
            let project_id = id();
            execute(db, "INSERT INTO NovelProject(id,name,language,genre,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", &[json!(project_id), json!(name), json!(language), if genre.is_empty() { Value::Null } else { json!(genre) }, json!(now()), json!(now())])?;
            Ok(json!({"project": project(db, &project_id)?}))
        }
        ("GET", ["api", "projects", project_id]) => {
            Ok(json!({"project": project(db, project_id)?}))
        }
        ("GET", ["api", "projects", project_id, "workspace"]) => {
            let p = project(db, project_id)?;
            let source = query(
                db,
                "SELECT * FROM SourceDocument WHERE projectId=? ORDER BY importedAt DESC LIMIT 1",
                &[json!(project_id)],
            )?
            .into_iter()
            .next();
            Ok(json!({"project":p,"source":source,"chapters":chapters(db, project_id)?}))
        }
        ("DELETE", ["api", "projects", project_id]) => {
            project(db, project_id)?;
            let directory = database::safe_path(root, &format!("projects/{project_id}"))?;
            execute(
                db,
                "DELETE FROM NovelProject WHERE id=?",
                &[json!(project_id)],
            )?;
            if directory.exists() {
                fs::remove_dir_all(directory)
                    .map_err(|e| format!("项目记录已删除，但文件清理失败：{e}"))?;
            }
            Ok(json!({"ok":true}))
        }
        ("GET", ["api", "projects", project_id, "chapters"]) => {
            project(db, project_id)?;
            Ok(json!({"chapters":chapters(db,project_id)?}))
        }
        ("POST", ["api", "projects", project_id, "import"]) => {
            import_source(db, root, project_id, body)
        }
        ("POST", ["api", "projects", project_id, "chapters", "reorder"]) => {
            project(db, project_id)?;
            let ids = body["orderedIds"].as_array().ok_or("排序列表无效。")?;
            let rows = chapters(db, project_id)?;
            let expected: HashSet<&str> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
            let actual: HashSet<&str> = ids.iter().filter_map(Value::as_str).collect();
            if actual != expected || ids.len() != expected.len() {
                return Err("排序列表与项目章节不一致，请刷新后重试。".into());
            }
            let tx = db.transaction().map_err(|e| e.to_string())?;
            for (i, id) in ids.iter().enumerate() {
                execute(
                    &tx,
                    "UPDATE Chapter SET sortOrder=?,updatedAt=? WHERE id=?",
                    &[json!(i + 1), json!(now()), id.clone()],
                )?;
            }
            touch(&tx, project_id)?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(json!({"chapters":chapters(db,project_id)?}))
        }
        ("GET", ["api", "chapters", chapter_id]) => {
            let mut row = chapter(db, chapter_id)?;
            view_chapter(&mut row, true);
            Ok(json!({"chapter":row}))
        }
        ("PATCH", ["api", "chapters", chapter_id]) => {
            let old = chapter(db, chapter_id)?;
            let title = if body.get("rawTitle").is_some() {
                text(body, "rawTitle", 1, 200)?
            } else {
                old["rawTitle"].as_str().unwrap_or("")
            };
            let index = body
                .get("normalizedIndex")
                .unwrap_or(&old["normalizedIndex"]);
            if !index.as_i64().is_some_and(|n| (0..=100000).contains(&n)) {
                return Err("章节编号无效。".into());
            }
            execute(
                db,
                "UPDATE Chapter SET rawTitle=?,normalizedIndex=?,updatedAt=? WHERE id=?",
                &[json!(title), index.clone(), json!(now()), json!(chapter_id)],
            )?;
            touch(db, old["projectId"].as_str().unwrap_or(""))?;
            let mut row = chapter(db, chapter_id)?;
            view_chapter(&mut row, true);
            Ok(json!({"chapter":row}))
        }
        ("DELETE", ["api", "chapters", chapter_id]) => {
            let old = chapter(db, chapter_id)?;
            let project_id = old["projectId"].as_str().unwrap_or("");
            let tx = db.transaction().map_err(|e| e.to_string())?;
            execute(&tx, "DELETE FROM Chapter WHERE id=?", &[json!(chapter_id)])?;
            resequence(&tx, project_id)?;
            touch(&tx, project_id)?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(json!({"ok":true}))
        }
        ("POST", ["api", "chapters", chapter_id, "split"]) => split(db, chapter_id, body),
        ("POST", ["api", "chapters", chapter_id, "merge"]) => merge(db, chapter_id, body),
        ("GET", ["api", "projects", project_id, "export"]) => {
            export_project(db, project_id, &req.path)
        }
        _ => Err("请求的操作不存在。".into()),
    }
}

fn text<'a>(body: &'a Value, key: &str, min: usize, max: usize) -> Result<&'a str> {
    let text = body[key]
        .as_str()
        .ok_or_else(|| format!("缺少字段：{key}"))?
        .trim();
    if !(min..=max).contains(&text.chars().count()) {
        return Err(format!("字段长度无效：{key}"));
    }
    Ok(text)
}

pub fn list_projects(db: &Connection) -> Result<Vec<Value>> {
    query(db,"SELECT p.*, (SELECT COUNT(*) FROM Chapter c WHERE c.projectId=p.id) AS chapterCount, (SELECT COUNT(*) FROM SourceDocument s WHERE s.projectId=p.id) AS sourceCount, (SELECT COUNT(*) FROM MemoryEntry m WHERE m.projectId=p.id) AS memoryCount FROM NovelProject p ORDER BY p.updatedAt DESC",&[])
}

fn project(db: &Connection, id: &str) -> Result<Value> {
    one(db, "SELECT * FROM NovelProject WHERE id=?", &[json!(id)])
}
fn chapter(db: &Connection, id: &str) -> Result<Value> {
    one(db, "SELECT * FROM Chapter WHERE id=?", &[json!(id)])
}
fn touch(db: &Connection, id: &str) -> Result<()> {
    execute(
        db,
        "UPDATE NovelProject SET updatedAt=? WHERE id=?",
        &[json!(now()), json!(id)],
    )?;
    Ok(())
}

fn view_chapter(row: &mut Value, content: bool) {
    row["charCount"] = json!(row["content"].as_str().unwrap_or("").encode_utf16().count());
    row["flags"] =
        serde_json::from_str(row["flagsJson"].as_str().unwrap_or("[]")).unwrap_or(json!([]));
    if !content {
        row.as_object_mut().unwrap().remove("content");
    }
}
pub fn chapters(db: &Connection, project_id: &str) -> Result<Vec<Value>> {
    let mut rows = query(
        db,
        "SELECT * FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?;
    for row in &mut rows {
        view_chapter(row, false);
    }
    Ok(rows)
}
fn resequence(db: &Connection, project_id: &str) -> Result<()> {
    for (i, row) in query(
        db,
        "SELECT id FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?
    .iter()
    .enumerate()
    {
        execute(
            db,
            "UPDATE Chapter SET sortOrder=?,updatedAt=? WHERE id=?",
            &[json!(i + 1), json!(now()), row["id"].clone()],
        )?;
    }
    Ok(())
}

fn has_active_run(db: &Connection, project_id: &str) -> Result<bool> {
    Ok(!query(
        db,
        "SELECT id FROM AnalysisRun WHERE projectId=? AND status IN ('pending','running') LIMIT 1",
        &[json!(project_id)],
    )?
    .is_empty())
}

fn import_source(
    db: &mut Connection,
    root: &Path,
    project_id: &str,
    body: &Value,
) -> Result<Value> {
    project(db, project_id)?;
    if has_active_run(db, project_id)? {
        return Err("项目仍有分析任务运行中，请先取消或等待任务结束。".into());
    }
    let file_name = text(body, "fileName", 1, 255)?;
    let format = text(body, "format", 1, 20)?;
    if !["txt", "markdown", "docx", "epub", "html", "pdf"].contains(&format) {
        return Err("文件格式不支持。".into());
    }
    let encoded = body["bytes"].as_str().ok_or("缺少原文。")?;
    if encoded.len() > MAX_FILE * 4 / 3 + 4 {
        return Err("单文件不得超过 50MB。".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "原文编码无效。")?;
    if bytes.is_empty() || bytes.len() > MAX_FILE {
        return Err("原文为空或超过 50MB。".into());
    }
    let rows = body["chapters"].as_array().ok_or("章节解析结果无效。")?;
    if rows.is_empty() || rows.len() > 100000 {
        return Err("未解析到可用章节或章节数量过多。".into());
    }
    let mut text_bytes = 0usize;
    for row in rows {
        text(row, "rawTitle", 1, 200)?;
        text_bytes =
            text_bytes.saturating_add(row["content"].as_str().ok_or("章节正文无效。")?.len());
        if text_bytes > 200 * 1024 * 1024 {
            return Err("解析后正文过大。".into());
        }
        let start = row["startOffset"].as_i64().ok_or("章节定位无效。")?;
        let end = row["endOffset"].as_i64().ok_or("章节定位无效。")?;
        if start < 0 || end < start {
            return Err("章节定位无效。".into());
        }
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let source_id = id();
    let stored = format!("projects/{project_id}/sources/{hash}-{source_id}.source");
    let absolute = database::safe_path(root, &stored)?;
    let previous = query(
        db,
        "SELECT storedPath FROM SourceDocument WHERE projectId=?",
        &[json!(project_id)],
    )?;
    fs::create_dir_all(absolute.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&absolute, &bytes).map_err(|e| e.to_string())?;
    let outcome = (|| -> Result<()> {
        let tx = db.transaction().map_err(|e| e.to_string())?;
        if has_active_run(&tx, project_id)? {
            return Err("项目仍有分析任务运行中，请先取消或等待任务结束。".into());
        }
        for table in [
            "NativeWorkflow",
            "MemoryProposal",
            "ContinuityIssue",
            "DraftChapter",
            "ContinuationPlan",
            "MemoryEntry",
            "CharacterKnowledge",
            "SourceCitation",
            "AnalysisRun",
            "Chapter",
            "SourceDocument",
        ] {
            execute(
                &tx,
                &format!("DELETE FROM {table} WHERE projectId=?"),
                &[json!(project_id)],
            )?;
        }
        execute(&tx,"INSERT INTO SourceDocument(id,projectId,fileName,format,storedPath,contentHash,encoding,byteSize,importedAt) VALUES(?,?,?,?,?,?,?,?,?)",&[json!(source_id),json!(project_id),json!(file_name),json!(format),json!(stored),json!(hash),body["encoding"].clone(),json!(bytes.len()),json!(now())])?;
        for (i, row) in rows.iter().enumerate() {
            execute(&tx,"INSERT INTO Chapter(id,projectId,sourceDocumentId,volumeNumber,volumeTitle,rawTitle,normalizedIndex,content,startOffset,endOffset,sortOrder,parseConfidence,flagsJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",&[json!(id()),json!(project_id),json!(source_id),row["volumeNumber"].clone(),row["volumeTitle"].clone(),row["rawTitle"].clone(),row["normalizedIndex"].clone(),row["content"].clone(),row["startOffset"].clone(),row["endOffset"].clone(),json!(i+1),row["confidence"].clone(),json!(row["flags"].to_string()),json!(now()),json!(now())])?;
        }
        touch(&tx, project_id)?;
        tx.commit().map_err(|e| e.to_string())
    })();
    if let Err(e) = outcome {
        let _ = fs::remove_file(&absolute);
        return Err(e);
    }
    for old in previous {
        if let Some(p) = old["storedPath"].as_str() {
            if let Ok(p) = database::safe_path(root, p) {
                let _ = fs::remove_file(p);
            }
        }
    }
    Ok(
        json!({"result":{"sourceDocumentId":source_id,"chapterCount":rows.len(),"warnings":body["warnings"],"contentHash":hash,"format":format,"fileName":file_name,"byteSize":bytes.len()}}),
    )
}

fn split(db: &mut Connection, chapter_id: &str, body: &Value) -> Result<Value> {
    let old = chapter(db, chapter_id)?;
    let content = old["content"].as_str().unwrap_or("");
    let offset = body["atOffset"].as_u64().ok_or("拆分位置无效。")? as usize;
    let mut utf16 = 0usize;
    let mut byte_offset = None;
    for (i, ch) in content.char_indices() {
        if utf16 == offset {
            byte_offset = Some(i);
            break;
        }
        utf16 += ch.len_utf16();
    }
    let byte_offset = byte_offset
        .filter(|n| *n > 0)
        .ok_or("拆分位置超出范围或位于不完整字符中。")?;
    let head = content[..byte_offset].trim_end();
    let tail = content[byte_offset..].trim_start();
    if head.is_empty() || tail.is_empty() {
        return Err("拆分后存在空章节，请调整位置。".into());
    }
    let project_id = old["projectId"].as_str().unwrap_or("");
    let order = old["sortOrder"].as_i64().unwrap_or(0);
    let boundary = old["startOffset"].as_i64().unwrap_or(0) + head.encode_utf16().count() as i64;
    let title = tail
        .lines()
        .next()
        .filter(|s| s.chars().count() <= 60 && s.starts_with('第'))
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}（续）", old["rawTitle"].as_str().unwrap_or("")));
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(
        &tx,
        "UPDATE Chapter SET sortOrder=sortOrder+1 WHERE projectId=? AND sortOrder>?",
        &[json!(project_id), json!(order)],
    )?;
    let mut flags: Vec<String> =
        serde_json::from_str(old["flagsJson"].as_str().unwrap_or("[]")).unwrap_or_default();
    if !flags.iter().any(|f| f == "manual-split") {
        flags.push("manual-split".into());
    }
    execute(&tx,"UPDATE Chapter SET content=?,endOffset=?,splitMethod='manual',flagsJson=?,updatedAt=? WHERE id=?",&[json!(head),json!(boundary),json!(serde_json::to_string(&flags).unwrap()),json!(now()),json!(chapter_id)])?;
    execute(&tx,"INSERT INTO Chapter(id,projectId,sourceDocumentId,volumeNumber,volumeTitle,rawTitle,normalizedIndex,content,startOffset,endOffset,sortOrder,splitMethod,parseConfidence,flagsJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,'manual',?,'[\"manual-split\"]',?,?)",&[json!(id()),json!(project_id),old["sourceDocumentId"].clone(),old["volumeNumber"].clone(),old["volumeTitle"].clone(),json!(title),old["normalizedIndex"].clone(),json!(tail),json!(boundary),old["endOffset"].clone(),json!(order+1),old["parseConfidence"].clone(),json!(now()),json!(now())])?;
    touch(&tx, project_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"chapters":chapters(db,project_id)?}))
}

fn merge(db: &mut Connection, chapter_id: &str, body: &Value) -> Result<Value> {
    let old = chapter(db, chapter_id)?;
    let next_id = text(body, "nextId", 1, 200)?;
    let next = chapter(db, next_id)?;
    if old["projectId"] != next["projectId"] || old["id"] == next["id"] {
        return Err("不能跨项目或与自身合并。".into());
    }
    let project_id = old["projectId"].as_str().unwrap_or("");
    let immediate = one(
        db,
        "SELECT id FROM Chapter WHERE projectId=? AND sortOrder>? ORDER BY sortOrder LIMIT 1",
        &[json!(project_id), old["sortOrder"].clone()],
    )?;
    if immediate["id"] != next["id"] {
        return Err("只能合并紧邻的下一章。".into());
    }
    let content = format!(
        "{}\n\n{}",
        old["content"].as_str().unwrap_or(""),
        next["content"].as_str().unwrap_or("")
    );
    let mut flags: Vec<String> =
        serde_json::from_str(old["flagsJson"].as_str().unwrap_or("[]")).unwrap_or_default();
    if !flags.iter().any(|f| f == "manual-split") {
        flags.push("manual-split".into());
    }
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(&tx,"UPDATE Chapter SET content=?,endOffset=?,splitMethod='manual',flagsJson=?,updatedAt=? WHERE id=?",&[json!(content.trim()),next["endOffset"].clone(),json!(serde_json::to_string(&flags).unwrap()),json!(now()),json!(chapter_id)])?;
    execute(&tx, "DELETE FROM Chapter WHERE id=?", &[json!(next_id)])?;
    resequence(&tx, project_id)?;
    touch(&tx, project_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"chapters":chapters(db,project_id)?}))
}

fn export_project(db: &Connection, project_id: &str, path: &str) -> Result<Value> {
    let p = project(db, project_id)?;
    let rows = query(
        db,
        "SELECT * FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?;
    if path
        .split('?')
        .nth(1)
        .is_some_and(|q| q.split('&').any(|s| s == "format=txt"))
    {
        let mut parts = Vec::new();
        let mut volume = String::new();
        for row in rows {
            let current = row["volumeTitle"].as_str().unwrap_or("");
            if !current.is_empty() && current != volume {
                parts.push(format!("【{current}】"));
            }
            volume = current.to_string();
            parts.push(
                format!(
                    "{}\n\n{}",
                    row["rawTitle"].as_str().unwrap_or(""),
                    row["content"].as_str().unwrap_or("")
                )
                .trim_end()
                .to_string(),
            );
        }
        return Ok(
            json!({"text":format!("\u{feff}{}\n",parts.join("\n\n\n")),"fileName":format!("{}.txt",p["name"].as_str().unwrap_or("project"))}),
        );
    }
    let mut out = json!({"app":"novel-continuation","exportVersion":2,"exportedAt":chrono::Utc::now().to_rfc3339(),"project":p});
    for (key, table, order) in [
        ("sources", "SourceDocument", "importedAt"),
        ("chapters", "Chapter", "sortOrder"),
        ("memoryEntries", "MemoryEntry", "createdAt"),
        ("characterKnowledge", "CharacterKnowledge", "createdAt"),
        ("continuityIssues", "ContinuityIssue", "createdAt"),
        ("continuationPlans", "ContinuationPlan", "createdAt"),
        ("draftChapters", "DraftChapter", "\"index\""),
        ("memoryProposals", "MemoryProposal", "createdAt"),
    ] {
        let mut records = query(
            db,
            &format!("SELECT * FROM {table} WHERE projectId=? ORDER BY {order}"),
            &[json!(project_id)],
        )?;
        for r in &mut records {
            for (from, to) in [
                ("flagsJson", "flags"),
                ("sourceCitationsJson", "citations"),
                ("evidenceJson", "evidence"),
                ("outlineJson", "outline"),
                ("relatedThreadsJson", "relatedThreads"),
                ("outlineItemJson", "outlineItem"),
                ("continuityCheckJson", "continuityCheck"),
                ("citationsJson", "citations"),
            ] {
                if let Some(s) = r[from].as_str() {
                    r[to] = serde_json::from_str(s).unwrap_or(json!([]));
                }
            }
            if let Some(obj) = r.as_object_mut() {
                for field in [
                    "storedPath",
                    "projectId",
                    "sourceDocumentId",
                    "apiKeyEncrypted",
                ] {
                    obj.remove(field);
                }
            }
        }
        out[key] = json!(records);
    }
    Ok(
        json!({"text":serde_json::to_string_pretty(&out).map_err(|e|e.to_string())?,"fileName":format!("{}.json",p["name"].as_str().unwrap_or("project"))}),
    )
}
