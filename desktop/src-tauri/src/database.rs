use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;

pub fn now() -> i64 {
    Utc::now().timestamp_millis()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn open(directory: &Path) -> Result<Connection> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let db = Connection::open(directory.join("app.db")).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    let exists: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("schema.sql"))
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    validate(&db)?;
    db.execute_batch(include_str!("automation.sql"))
        .map_err(|e| e.to_string())?;
    Ok(db)
}

pub fn validate(db: &Connection) -> Result<()> {
    let health: String = db
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if health != "ok" {
        return Err("数据库检查失败，请从备份恢复。".into());
    }
    for table in [
        "NovelProject",
        "SourceDocument",
        "Chapter",
        "ModelProfile",
        "MemoryEntry",
        "MemoryProposal",
        "ContinuityIssue",
        "DraftChapter",
        "ContinuationPlan",
        "AnalysisRun",
        "CharacterKnowledge",
        "SourceCitation",
    ] {
        db.prepare(&format!("SELECT * FROM \"{table}\" LIMIT 0"))
            .map_err(|_| "工作区数据库版本不兼容，请先使用原版完成升级。".to_string())?;
    }
    db.prepare("SELECT progressJson,updatedAt,authorizedAt FROM AnalysisRun LIMIT 0")
        .map_err(|_| "工作区需要先使用原版完成数据库升级。".to_string())?;
    db.prepare("SELECT draftId FROM MemoryProposal LIMIT 0")
        .map_err(|_| "工作区需要先使用原版完成数据库升级。".to_string())?;
    db.prepare("SELECT draftId FROM ContinuityIssue LIMIT 0")
        .map_err(|_| "工作区需要先使用原版完成数据库升级。".to_string())?;
    Ok(())
}

fn sql_value(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as S;
    match v {
        Value::Null => S::Null,
        Value::Bool(b) => S::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(S::Integer)
            .unwrap_or_else(|| S::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => S::Text(s.clone()),
        _ => S::Text(v.to_string()),
    }
}

fn timestamp(value: Value) -> Value {
    if let Some(ms) = value.as_i64() {
        return DateTime::from_timestamp_millis(ms)
            .map(|d| json!(d.to_rfc3339_opts(SecondsFormat::Millis, true)))
            .unwrap_or(value);
    }
    if let Some(s) = value.as_str() {
        if let Ok(d) = DateTime::parse_from_rfc3339(s) {
            return json!(d.to_rfc3339_opts(SecondsFormat::Millis, true));
        }
        if let Ok(d) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f") {
            return json!(d.and_utc().to_rfc3339_opts(SecondsFormat::Millis, true));
        }
    }
    value
}

pub fn query(db: &Connection, sql: &str, args: &[Value]) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map(params_from_iter(args.iter().map(sql_value)), |row| {
            let mut item = Map::new();
            for (i, name) in names.iter().enumerate() {
                let mut value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(s) => json!(String::from_utf8_lossy(s)),
                    ValueRef::Blob(_) => Value::Null,
                };
                if name.ends_with("At") {
                    value = timestamp(value);
                }
                if [
                    "isReadOnly",
                    "isDefault",
                    "isLocal",
                    "isUserEdited",
                    "isCurrent",
                ]
                .contains(&name.as_str())
                {
                    value = value.as_i64().map(|n| json!(n != 0)).unwrap_or(value);
                }
                item.insert(name.clone(), value);
            }
            Ok(Value::Object(item))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn one(db: &Connection, sql: &str, args: &[Value]) -> Result<Value> {
    query(db, sql, args)?
        .into_iter()
        .next()
        .ok_or_else(|| "记录不存在。".into())
}

pub fn execute(db: &Connection, sql: &str, args: &[Value]) -> Result<usize> {
    db.execute(sql, params_from_iter(args.iter().map(sql_value)))
        .map_err(|e| e.to_string())
}

pub fn safe_path(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty() || relative.contains('\\') || relative.contains(':') {
        return Err("文件路径无效。".into());
    }
    let path = Path::new(relative);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("文件路径超出工作区。".into());
    }
    let target = root.join(path);
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut ancestor = target.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| "文件路径无效。".to_string())?;
    }
    if !ancestor
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(canonical_root)
    {
        return Err("文件路径超出工作区。".into());
    }
    Ok(target)
}

pub fn snapshot(source: &Path, destination: &Path) -> Result<()> {
    let db = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    validate(&db)?;
    db.backup("main", destination, None)
        .map_err(|e| e.to_string())
}
