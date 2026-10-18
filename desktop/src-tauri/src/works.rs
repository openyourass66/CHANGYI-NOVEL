use crate::database::{execute, id, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

// The archive owns its text; source links may disappear without deleting a work.
pub fn archive(db: &Connection, workflow: &Value, generated_at: i64) -> Result<String> {
    let workflow_id = workflow["id"].as_str().ok_or("流程编号无效。")?;
    if let Some(existing) = query(
        db,
        "SELECT id FROM NativeWork WHERE workflowId=?",
        &[json!(workflow_id)],
    )?
    .first()
    {
        return Ok(existing["id"].as_str().ok_or("作品编号无效。")?.into());
    }
    let config: Value = serde_json::from_str(workflow["configJson"].as_str().unwrap_or("{}"))
        .map_err(|_| "流程配置损坏。")?;
    let project = one(
        db,
        "SELECT name FROM NovelProject WHERE id=?",
        &[workflow["projectId"].clone()],
    )?;
    let plan = one(
        db,
        "SELECT direction FROM ContinuationPlan WHERE id=? AND projectId=?",
        &[config["planId"].clone(), workflow["projectId"].clone()],
    )?;
    let chapters = query(db,"SELECT \"index\",title,content FROM DraftChapter WHERE projectId=? AND planId=? ORDER BY \"index\"", &[workflow["projectId"].clone(),config["planId"].clone()])?;
    if chapters.is_empty() {
        return Err("尚无正文可保存为作品。".into());
    }
    let work_id = id();
    let title = format!(
        "{} · {}",
        project["name"].as_str().unwrap_or("续写作品"),
        plan["direction"].as_str().unwrap_or("续写")
    );
    execute(db,"INSERT INTO NativeWork(id,workflowId,title,sourceProjectId,sourceProjectName,direction,generatedAt) VALUES(?,?,?,?,?,?,?)", &[json!(work_id),json!(workflow_id),json!(title),workflow["projectId"].clone(),project["name"].clone(),plan["direction"].clone(),json!(generated_at)])?;
    for chapter in chapters {
        execute(
            db,
            "INSERT INTO NativeWorkChapter(id,workId,\"index\",title,content) VALUES(?,?,?,?,?)",
            &[
                json!(id()),
                json!(work_id),
                chapter["index"].clone(),
                chapter["title"].clone(),
                chapter["content"].clone(),
            ],
        )?;
    }
    Ok(work_id)
}
pub fn backfill(db: &Connection) -> Result<()> {
    let rows=query(db,"SELECT w.*,CAST(w.updatedAt AS INTEGER) AS finishedMillis FROM NativeWorkflow w JOIN ContinuationPlan p ON p.id=json_extract(w.configJson,'$.planId') AND p.projectId=w.projectId WHERE w.kind='continue' AND w.status='done' AND NOT EXISTS (SELECT 1 FROM NativeWork k WHERE k.workflowId=w.id) AND EXISTS (SELECT 1 FROM DraftChapter d WHERE d.planId=p.id)", &[])?;
    if rows.is_empty() {
        return Ok(());
    }
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    for row in rows {
        archive(
            &tx,
            &row,
            row["finishedMillis"].as_i64().ok_or("历史流程时间无效。")?,
        )?;
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn route(db: &mut Connection, method: &str, parts: &[&str]) -> Option<Result<Value>> {
    Some(match (method, parts) {
        ("GET", ["api", "works"]) => list(db),
        ("GET", ["api", "works", work]) => detail(db, work).map(|work| json!({"work":work})),
        ("DELETE", ["api", "works", work]) => (|| {
            let tx = db.transaction().map_err(|e| e.to_string())?;
            execute(
                &tx,
                "UPDATE NativeWork SET deletedAt=? WHERE id=? AND deletedAt IS NULL",
                &[json!(crate::database::now()), json!(work)],
            )?;
            execute(
                &tx,
                "DELETE FROM NativeWorkChapter WHERE workId=?",
                &[json!(work)],
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(json!({"ok":true}))
        })(),
        _ => return None,
    })
}
fn list(db: &Connection) -> Result<Value> {
    let rows=query(db,"SELECT w.id,w.title,w.sourceProjectId,w.sourceProjectName,w.direction,w.generatedAt,COUNT(c.id) AS chapterCount,COALESCE(SUM(LENGTH(c.content)),0) AS charCount FROM NativeWork w LEFT JOIN NativeWorkChapter c ON c.workId=w.id WHERE w.deletedAt IS NULL GROUP BY w.id ORDER BY w.generatedAt DESC,w.id", &[])?;
    Ok(json!({"works":rows}))
}
fn detail(db: &Connection, id: &str) -> Result<Value> {
    let mut work=one(db,"SELECT id,title,sourceProjectId,sourceProjectName,direction,generatedAt FROM NativeWork WHERE id=? AND deletedAt IS NULL", &[json!(id)])?;
    work["chapters"]=json!(query(db,"SELECT id,\"index\",title,content,1 AS version FROM NativeWorkChapter WHERE workId=? ORDER BY \"index\"", &[json!(id)])?);
    Ok(work)
}
