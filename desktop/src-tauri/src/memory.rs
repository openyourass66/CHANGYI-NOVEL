use crate::database::{execute, id, now, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

const CATEGORIES: &[&str] = &[
    "chapter-note",
    "story-bible",
    "character",
    "timeline",
    "thread",
    "style",
    "glossary",
    "summary",
    "outline",
];
const STATUSES: &[&str] = &[
    "confirmed",
    "inferred",
    "unknown",
    "open",
    "advanced",
    "resolved",
    "uncertain",
];

pub fn route(
    db: &mut Connection,
    method: &str,
    parts: &[&str],
    path: &str,
    body: &Value,
) -> Option<Result<Value>> {
    let result = match (method, parts) {
        ("GET", ["api", "projects", project_id, "memory"]) => {
            let params = path.split_once('?').map(|(_, q)| q).unwrap_or("");
            let query: HashMap<String, String> = url::form_urlencoded::parse(params.as_bytes())
                .into_owned()
                .collect();
            list(db, project_id, query.get("category"), query.get("q"))
        }
        ("POST", ["api", "projects", project_id, "memory"]) => {
            create(db, project_id, body).map(|entry| json!({"entry":entry}))
        }
        ("POST", ["api", "projects", project_id, "memory", "import"]) => {
            import_files(db, project_id, body)
        }
        ("GET", ["api", "projects", project_id, "memory", "export"]) => export(db, project_id),
        ("GET", ["api", "projects", project_id, "knowledge"]) => {
            knowledge(db, project_id).map(|rows| json!({"knowledge":rows}))
        }
        ("POST", ["api", "projects", project_id, "knowledge"]) => {
            create_knowledge(db, project_id, body).map(|item| json!({"item":item}))
        }
        ("GET", ["api", "memory", entry_id]) => {
            entry(db, entry_id).map(|entry| json!({"entry":entry}))
        }
        ("PATCH", ["api", "memory", entry_id]) => {
            update(db, entry_id, body).map(|entry| json!({"entry":entry}))
        }
        ("DELETE", ["api", "memory", entry_id]) => delete(db, entry_id),
        ("GET", ["api", "memory", entry_id, "history"]) => {
            history(db, entry_id).map(|history| json!({"history":history}))
        }
        ("POST", ["api", "memory", entry_id, "history"]) => {
            restore(db, entry_id, body).map(|entry| json!({"entry":entry}))
        }
        ("PATCH", ["api", "knowledge", item_id]) => {
            update_knowledge(db, item_id, body).map(|item| json!({"item":item}))
        }
        ("DELETE", ["api", "knowledge", item_id]) => delete_knowledge(db, item_id),
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

fn labels(db: &Connection, project_id: &str) -> Result<HashMap<String, (String, usize)>> {
    Ok(query(
        db,
        "SELECT id,rawTitle FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?
    .into_iter()
    .enumerate()
    .filter_map(|(index, row)| {
        Some((
            row["id"].as_str()?.to_string(),
            (row["rawTitle"].as_str()?.to_string(), index + 1),
        ))
    })
    .collect())
}

fn to_view(mut row: Value, labels: &HashMap<String, (String, usize)>) -> Value {
    let citations: Vec<Value> =
        serde_json::from_str(row["sourceCitationsJson"].as_str().unwrap_or("[]"))
            .unwrap_or_default();
    row["citations"] = Value::Array(
        citations
            .into_iter()
            .filter_map(|mut citation| {
                let chapter_id = citation["chapterId"].as_str()?;
                let (title, index) = labels
                    .get(chapter_id)
                    .cloned()
                    .unwrap_or(("（章节已删除）".into(), 0));
                citation["chapterTitle"] = json!(title);
                citation["chapterIndex"] = json!(index);
                Some(citation)
            })
            .collect(),
    );
    row
}

fn entry(db: &Connection, entry_id: &str) -> Result<Value> {
    let row = one(
        db,
        "SELECT * FROM MemoryEntry WHERE id=?",
        &[json!(entry_id)],
    )?;
    let labels = labels(db, row["projectId"].as_str().unwrap_or(""))?;
    Ok(to_view(row, &labels))
}

fn list(
    db: &Connection,
    project_id: &str,
    category: Option<&String>,
    search: Option<&String>,
) -> Result<Value> {
    exists_project(db, project_id)?;
    let category = category.map(String::as_str).unwrap_or("");
    if !category.is_empty() && !CATEGORIES.contains(&category) {
        return Err("记忆分类无效。".into());
    }
    let search = search.map(|value| value.trim()).unwrap_or("");
    if search.chars().count() > 200 {
        return Err("搜索内容过长。".into());
    }
    let labels = labels(db, project_id)?;
    let entries: Vec<Value> = query(db,
        "SELECT * FROM MemoryEntry WHERE projectId=? AND isCurrent=1 AND (?='' OR category=?) AND (?='' OR instr(content,?)>0 OR instr(coalesce(title,''),?)>0 OR instr(coalesce(key,''),?)>0) ORDER BY category,updatedAt DESC",
        &[json!(project_id),json!(category),json!(category),json!(search),json!(search),json!(search),json!(search)])?
        .into_iter().map(|row| to_view(row, &labels)).collect();
    let counts = query(db, "SELECT category,COUNT(*) AS count FROM MemoryEntry WHERE projectId=? AND isCurrent=1 GROUP BY category", &[json!(project_id)])?
        .into_iter().filter_map(|r| Some((r["category"].as_str()?.to_string(), r["count"].clone())))
        .collect::<serde_json::Map<String, Value>>();
    let all: Vec<Value> = query(db, "SELECT * FROM MemoryEntry WHERE projectId=? AND isCurrent=1 AND key IS NOT NULL ORDER BY updatedAt DESC", &[json!(project_id)])?
        .into_iter().map(|row| to_view(row, &labels)).collect();
    let mut grouped: HashMap<(String, String), Vec<Value>> = HashMap::new();
    for row in all {
        let key = (
            row["category"].as_str().unwrap_or("").to_string(),
            row["key"].as_str().unwrap_or("").to_string(),
        );
        grouped.entry(key).or_default().push(row);
    }
    let conflicts: Vec<Value> = grouped
        .into_iter()
        .filter_map(|((category, key), entries)| {
            (entries.len() > 1).then(|| json!({"category":category,"key":key,"entries":entries}))
        })
        .collect();
    Ok(json!({"entries":entries,"counts":counts,"conflicts":conflicts}))
}

struct Input {
    category: String,
    key: Option<String>,
    title: Option<String>,
    content: String,
    status: String,
    citations: String,
}

fn optional_text(body: &Value, key: &str, max: usize) -> Result<Option<String>> {
    let Some(value) = body.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let value = value
        .as_str()
        .ok_or_else(|| format!("字段格式无效：{key}"))?
        .trim();
    if value.encode_utf16().count() > max {
        return Err(format!("字段长度无效：{key}"));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

fn required_text(body: &Value, key: &str, max: usize) -> Result<String> {
    optional_text(body, key, max)?.ok_or_else(|| format!("请填写{key}。"))
}

fn input(db: &Connection, project_id: &str, body: &Value) -> Result<Input> {
    let category = required_text(body, "category", 30)?;
    let status = required_text(body, "status", 20)?;
    if !CATEGORIES.contains(&category.as_str()) || !STATUSES.contains(&status.as_str()) {
        return Err("记忆分类或状态无效。".into());
    }
    let allowed = match category.as_str() {
        "thread" => &["open", "advanced", "resolved", "uncertain"][..],
        "style" | "summary" => &["confirmed", "inferred"][..],
        _ => &["confirmed", "inferred", "unknown"][..],
    };
    if !allowed.contains(&status.as_str()) {
        return Err("该分类不支持此状态。".into());
    }
    let citations = body
        .get("citations")
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or(json!([]));
    let rows = citations.as_array().ok_or("出处格式无效。")?;
    if rows.len() > 50 {
        return Err("出处数量超过 50 条。".into());
    }
    let mut clean = Vec::new();
    for row in rows {
        let chapter_id = required_text(row, "chapterId", 100)?;
        let excerpt = optional_text(row, "excerpt", 500)?.unwrap_or_default();
        let start = row["startOffset"].as_i64().ok_or("出处起点无效。")?;
        let end = row["endOffset"].as_i64().ok_or("出处终点无效。")?;
        if start < 0 || end < start {
            return Err("出处偏移无效。".into());
        }
        let chapter = query(
            db,
            "SELECT projectId FROM Chapter WHERE id=?",
            &[json!(chapter_id)],
        )?;
        if chapter
            .first()
            .is_some_and(|row| row["projectId"] != project_id)
        {
            return Err("出处章节不属于当前项目。".into());
        }
        clean.push(
            json!({"chapterId":chapter_id,"excerpt":excerpt,"startOffset":start,"endOffset":end}),
        );
    }
    Ok(Input {
        category,
        status,
        key: optional_text(body, "key", 120)?,
        title: optional_text(body, "title", 200)?,
        content: required_text(body, "content", 20000)?,
        citations: json!(clean).to_string(),
    })
}

fn create(db: &mut Connection, project_id: &str, body: &Value) -> Result<Value> {
    exists_project(db, project_id)?;
    let input = input(db, project_id, body)?;
    let entry_id = id();
    let at = now();
    execute(db,"INSERT INTO MemoryEntry(id,projectId,category,key,title,content,status,sourceCitationsJson,isUserEdited,revision,isCurrent,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,1,1,1,?,?)",
        &[json!(entry_id),json!(project_id),json!(input.category),json!(input.key),json!(input.title),json!(input.content),json!(input.status),json!(input.citations),json!(at),json!(at)])?;
    entry(db, &entry_id)
}

fn head(db: &Connection, entry_id: &str) -> Result<Value> {
    let mut row = one(
        db,
        "SELECT * FROM MemoryEntry WHERE id=?",
        &[json!(entry_id)],
    )?;
    for _ in 0..1000 {
        let child = query(
            db,
            "SELECT * FROM MemoryEntry WHERE supersedesId=? ORDER BY createdAt DESC LIMIT 1",
            &[row["id"].clone()],
        )?;
        let Some(next) = child.into_iter().next() else {
            return Ok(row);
        };
        if next["projectId"] != row["projectId"] {
            return Err("记忆版本链跨项目。".into());
        }
        row = next;
    }
    Err("记忆版本链过长或损坏。".into())
}

fn chain(db: &Connection, entry_id: &str) -> Result<Vec<Value>> {
    let mut row = head(db, entry_id)?;
    let mut rows = Vec::new();
    for _ in 0..1000 {
        let parent = row["supersedesId"].as_str().map(str::to_string);
        rows.push(row);
        let Some(parent) = parent else {
            return Ok(rows);
        };
        let next = one(db, "SELECT * FROM MemoryEntry WHERE id=?", &[json!(parent)])?;
        if next["projectId"] != rows[0]["projectId"] {
            return Err("记忆版本链跨项目。".into());
        }
        row = next;
    }
    Err("记忆版本链过长或损坏。".into())
}

fn history(db: &Connection, entry_id: &str) -> Result<Vec<Value>> {
    let rows = chain(db, entry_id)?;
    let labels = labels(db, rows[0]["projectId"].as_str().unwrap_or(""))?;
    Ok(rows.into_iter().map(|row| to_view(row, &labels)).collect())
}

fn append(db: &mut Connection, current: Value, input: Input) -> Result<Value> {
    let entry_id = current["id"].as_str().ok_or("记忆条目无效。")?.to_string();
    if current["category"] == input.category
        && current["key"] == json!(input.key)
        && current["title"] == json!(input.title)
        && current["content"] == input.content
        && current["status"] == input.status
        && current["sourceCitationsJson"] == input.citations
    {
        return entry(db, &entry_id);
    }
    let project_id = current["projectId"]
        .as_str()
        .ok_or("记忆项目无效。")?
        .to_string();
    let next_id = id();
    let at = now();
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(
        &tx,
        "UPDATE MemoryEntry SET isCurrent=0 WHERE id=?",
        &[json!(entry_id)],
    )?;
    execute(&tx,"INSERT INTO MemoryEntry(id,projectId,category,key,title,content,status,sourceCitationsJson,isUserEdited,revision,isCurrent,supersedesId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,1,?,1,?,?,?)",
        &[json!(next_id),json!(project_id),json!(input.category),json!(input.key),json!(input.title),json!(input.content),json!(input.status),json!(input.citations),json!(current["revision"].as_i64().unwrap_or(1)+1),json!(entry_id),json!(at),json!(at)])?;
    tx.commit().map_err(|e| e.to_string())?;
    entry(db, &next_id)
}

fn update(db: &mut Connection, entry_id: &str, body: &Value) -> Result<Value> {
    let current = head(db, entry_id)?;
    let project_id = current["projectId"].as_str().ok_or("记忆项目无效。")?;
    let input = input(db, project_id, body)?;
    append(db, current, input)
}

fn restore(db: &mut Connection, entry_id: &str, body: &Value) -> Result<Value> {
    let revision = body["revision"]
        .as_i64()
        .filter(|n| *n >= 1)
        .ok_or("历史版本号无效。")?;
    let rows = chain(db, entry_id)?;
    let target = rows
        .iter()
        .find(|row| row["revision"] == revision)
        .ok_or("未找到该历史版本。")?;
    let input = json!({"category":target["category"],"key":target["key"],"title":target["title"],"content":target["content"],"status":target["status"],"citations":serde_json::from_str::<Value>(target["sourceCitationsJson"].as_str().unwrap_or("[]")).unwrap_or(json!([]))});
    update(db, entry_id, &input)
}

fn delete(db: &mut Connection, entry_id: &str) -> Result<Value> {
    let rows = chain(db, entry_id)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for row in rows {
        execute(
            &tx,
            "DELETE FROM MemoryEntry WHERE id=?",
            &[row["id"].clone()],
        )?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"ok":true}))
}

fn knowledge(db: &Connection, project_id: &str) -> Result<Vec<Value>> {
    exists_project(db, project_id)?;
    query(db,"SELECT id,characterName,infoItem,relation,createdAt FROM CharacterKnowledge WHERE projectId=? ORDER BY characterName,createdAt",&[json!(project_id)])
}

fn knowledge_input(body: &Value) -> Result<(String, String, String)> {
    let name = required_text(body, "characterName", 80)?;
    let info = required_text(body, "infoItem", 500)?;
    let relation = required_text(body, "relation", 20)?;
    if !["known", "misbelieved", "unknown"].contains(&relation.as_str()) {
        return Err("人物认知关系无效。".into());
    }
    Ok((name, info, relation))
}

fn create_knowledge(db: &Connection, project_id: &str, body: &Value) -> Result<Value> {
    exists_project(db, project_id)?;
    let (name, info, relation) = knowledge_input(body)?;
    let item_id = id();
    execute(db,"INSERT INTO CharacterKnowledge(id,projectId,characterName,infoItem,relation,createdAt) VALUES(?,?,?,?,?,?)",
        &[json!(item_id),json!(project_id),json!(name),json!(info),json!(relation),json!(now())])?;
    one(
        db,
        "SELECT id,characterName,infoItem,relation,createdAt FROM CharacterKnowledge WHERE id=?",
        &[json!(item_id)],
    )
}

fn update_knowledge(db: &Connection, item_id: &str, body: &Value) -> Result<Value> {
    one(
        db,
        "SELECT id FROM CharacterKnowledge WHERE id=?",
        &[json!(item_id)],
    )?;
    let (name, info, relation) = knowledge_input(body)?;
    execute(
        db,
        "UPDATE CharacterKnowledge SET characterName=?,infoItem=?,relation=? WHERE id=?",
        &[json!(name), json!(info), json!(relation), json!(item_id)],
    )?;
    one(
        db,
        "SELECT id,characterName,infoItem,relation,createdAt FROM CharacterKnowledge WHERE id=?",
        &[json!(item_id)],
    )
}

fn delete_knowledge(db: &Connection, item_id: &str) -> Result<Value> {
    one(
        db,
        "SELECT id FROM CharacterKnowledge WHERE id=?",
        &[json!(item_id)],
    )?;
    execute(
        db,
        "DELETE FROM CharacterKnowledge WHERE id=?",
        &[json!(item_id)],
    )?;
    Ok(json!({"ok":true}))
}

fn export(db: &Connection, project_id: &str) -> Result<Value> {
    let project = one(
        db,
        "SELECT name FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    let rows=query(db,"SELECT * FROM MemoryEntry WHERE projectId=? AND isCurrent=1 ORDER BY category,updatedAt DESC",&[json!(project_id)])?;
    let labels = labels(db, project_id)?;
    let mut lines = vec![
        format!(
            "# {} — 故事记忆",
            project["name"].as_str().unwrap_or("项目")
        ),
        String::new(),
        format!(
            "导出时间：{}",
            chrono::Local::now().format("%Y/%m/%d %H:%M:%S")
        ),
        String::new(),
    ];
    for category in CATEGORIES {
        let category_rows: Vec<_> = rows.iter().filter(|r| r["category"] == *category).collect();
        if category_rows.is_empty() {
            continue;
        }
        let label = match *category {
            "chapter-note" => "章节笔记",
            "story-bible" => "设定集",
            "character" => "人物",
            "timeline" => "时间线",
            "thread" => "悬念台账",
            "style" => "文风",
            "glossary" => "术语表",
            "summary" => "全书概要",
            _ => "续写大纲",
        };
        lines.extend([format!("## {label}"), String::new()]);
        for row in category_rows {
            let view = to_view(row.clone(), &labels);
            let heading = view["title"]
                .as_str()
                .or_else(|| view["key"].as_str())
                .unwrap_or("（无标题）");
            lines.push(format!("### {heading}"));
            lines.push(format!("- 状态：{}", view["status"].as_str().unwrap_or("")));
            if let Some(key) = view["key"].as_str() {
                lines.push(format!("- 键：{key}"));
            }
            lines.push(String::new());
            lines.push(view["content"].as_str().unwrap_or("").to_string());
            if let Some(citations) = view["citations"].as_array().filter(|a| !a.is_empty()) {
                lines.extend([String::new(), "出处：".into()]);
                for c in citations {
                    let excerpt = c["excerpt"].as_str().unwrap_or("");
                    let suffix = if excerpt.is_empty() {
                        String::new()
                    } else {
                        format!("：{excerpt}")
                    };
                    lines.push(format!(
                        "- 第 {} 章《{}》{suffix}",
                        c["chapterIndex"],
                        c["chapterTitle"].as_str().unwrap_or("")
                    ));
                }
            }
            lines.push(String::new());
        }
    }
    Ok(
        json!({"text":format!("{}\n",lines.join("\n")),"fileName":format!("{}-记忆.md",project["name"].as_str().unwrap_or("项目"))}),
    )
}

fn import_files(db: &mut Connection, project_id: &str, body: &Value) -> Result<Value> {
    exists_project(db, project_id)?;
    let files = body["files"].as_array().ok_or("记忆文件列表无效。")?;
    if files.is_empty() || files.len() > 20 {
        return Err("一次最多导入 20 个记忆文件。".into());
    }
    let mut results = Vec::new();
    for file in files {
        let file_name = required_text(file, "fileName", 255)?;
        let kind = file["kind"].as_str().map(str::to_string);
        let warnings = file["warnings"].as_array().cloned().unwrap_or_default();
        let mut result = json!({"fileName":file_name,"kind":kind,"warnings":warnings,"imported":0,"skipped":0,"knowledge":0});
        if let Some(error) = file["error"].as_str() {
            result["error"] = json!(error);
            results.push(result);
            continue;
        }
        if kind.is_none() {
            results.push(result);
            continue;
        }
        let attempt = (|| -> Result<(usize, usize, usize)> {
            let entries = file["entries"].as_array().ok_or("记忆条目列表无效。")?;
            let knowledge = file["knowledge"].as_array().ok_or("人物认知列表无效。")?;
            if entries.len() > 10000 || knowledge.len() > 10000 {
                return Err("单文件条目数量过多。".into());
            }
            let tx = db.transaction().map_err(|e| e.to_string())?;
            let mut imported = 0;
            let mut skipped = 0;
            let mut known = 0;
            for row in entries {
                let input = input(&tx, project_id, row)?;
                if let Some(key) = &input.key {
                    if !query(&tx,"SELECT id FROM MemoryEntry WHERE projectId=? AND category=? AND key=? AND isCurrent=1 LIMIT 1",
                        &[json!(project_id),json!(input.category),json!(key)])?.is_empty() {
                        skipped+=1;
                        continue;
                    }
                }
                execute(&tx,"INSERT INTO MemoryEntry(id,projectId,category,key,title,content,status,sourceCitationsJson,isUserEdited,revision,isCurrent,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,1,1,1,?,?)",
                    &[json!(id()),json!(project_id),json!(input.category),json!(input.key),json!(input.title),json!(input.content),json!(input.status),json!(input.citations),json!(now()),json!(now())])?;
                imported += 1;
            }
            for row in knowledge {
                let (name, info, relation) = knowledge_input(row)?;
                if !query(&tx,"SELECT id FROM CharacterKnowledge WHERE projectId=? AND characterName=? AND infoItem=? AND relation=? LIMIT 1",
                    &[json!(project_id),json!(name),json!(info),json!(relation)])?.is_empty() { continue; }
                execute(&tx,"INSERT INTO CharacterKnowledge(id,projectId,characterName,infoItem,relation,createdAt) VALUES(?,?,?,?,?,?)",
                    &[json!(id()),json!(project_id),json!(name),json!(info),json!(relation),json!(now())])?;
                known += 1;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok((imported, skipped, known))
        })();
        match attempt {
            Ok((imported, skipped, known)) => {
                result["imported"] = json!(imported);
                result["skipped"] = json!(skipped);
                result["knowledge"] = json!(known);
            }
            Err(error) => result["error"] = json!(error),
        }
        results.push(result);
    }
    let totals = json!({
        "imported":results.iter().map(|r|r["imported"].as_u64().unwrap_or(0)).sum::<u64>(),
        "skipped":results.iter().map(|r|r["skipped"].as_u64().unwrap_or(0)).sum::<u64>(),
        "knowledge":results.iter().map(|r|r["knowledge"].as_u64().unwrap_or(0)).sum::<u64>()
    });
    Ok(json!({"summary":{"files":results,"totals":totals}}))
}
