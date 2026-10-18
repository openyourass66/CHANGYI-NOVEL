use crate::database::{execute, id, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;

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
    crate::chapter_titles::save_work(db, &work_id, crate::chapter_titles::plan_first(db, config["planId"].as_str().unwrap_or(""))?)?;
    for chapter in chapters {
        execute(
            db,
            "INSERT INTO NativeWorkChapter(id,workId,\"index\",title,content) VALUES(?,?,?,?,?)",
            &[
                json!(id()),
                json!(work_id),
                chapter["index"].clone(),
                json!(crate::chapter_titles::display_title(&chapter["title"])),
                chapter["content"].clone(),
            ],
        )?;
    }
    capture_memory(db, &work_id)?;
    Ok(work_id)
}
fn capture_memory(db: &Connection, work_id: &str) -> Result<()> {
    let rows = query(db, "SELECT p.*,c.\"index\" AS workChapterIndex FROM NativeWork w JOIN NativeWorkChapter c ON c.workId=w.id JOIN NativeWorkflow f ON f.id=w.workflowId JOIN DraftChapter d ON d.projectId=w.sourceProjectId AND d.planId=json_extract(f.configJson,'$.planId') AND d.\"index\"=c.\"index\" AND d.content=c.content JOIN MemoryProposal p ON p.draftId=d.id JOIN AnalysisRun r ON r.id=p.runId WHERE w.id=? AND p.state!='rejected' AND r.taskType='draft-memory' AND json_extract(r.inputRangeJson,'$.payload.workflowId')=w.workflowId", &[json!(work_id)])?;
    for row in rows {
        execute(db,"INSERT OR IGNORE INTO NativeWorkMemory(id,workId,chapterIndex,sourceProposalId,payloadJson) VALUES(?,?,?,?,?)", &[json!(id()),json!(work_id),row["workChapterIndex"].clone(),row["id"].clone(),json!(row.to_string())])?;
    }
    Ok(())
}
pub fn backfill(db: &Connection) -> Result<()> {
    let rows=query(db,"SELECT w.*,CAST(w.updatedAt AS INTEGER) AS finishedMillis FROM NativeWorkflow w JOIN ContinuationPlan p ON p.id=json_extract(w.configJson,'$.planId') AND p.projectId=w.projectId WHERE w.kind='continue' AND w.status='done' AND NOT EXISTS (SELECT 1 FROM NativeWork k WHERE k.workflowId=w.id) AND EXISTS (SELECT 1 FROM DraftChapter d WHERE d.planId=p.id)", &[])?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    for row in rows {
        archive(
            &tx,
            &row,
            row["finishedMillis"].as_i64().ok_or("历史流程时间无效。")?,
        )?;
    }
    for work in query(&tx,"SELECT id FROM NativeWork WHERE deletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM NativeWorkMerge m WHERE m.workId=NativeWork.id)", &[])? {
        capture_memory(&tx, work["id"].as_str().ok_or("作品编号无效。")?)?;
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn route(db: &mut Connection, root: &Path, method: &str, parts: &[&str], body: &Value) -> Option<Result<Value>> {
    Some(match (method, parts) {
        ("GET", ["api", "works"]) => list(db),
        ("GET", ["api", "works", work]) => detail(db, work).map(|work| json!({"work":work})),
        ("POST", ["api", "works", work, "merge"]) => if body["confirmed"] != true { Err("请先确认将正文和记忆并入原作。".into()) } else { crate::work_merge::merge(db, root, work) },
        ("DELETE", ["api", "works", work]) => (|| {
            let tx = db.transaction().map_err(|e| e.to_string())?;
            execute(
                &tx,
                "UPDATE NativeWork SET deletedAt=? WHERE id=? AND deletedAt IS NULL",
                &[json!(crate::database::now()), json!(work)],
            )?;
            execute(&tx,"DELETE FROM NativeWorkMemory WHERE workId=?", &[json!(work)])?;
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
    let rows=query(db,"SELECT w.id,w.title,w.sourceProjectId,w.sourceProjectName,w.direction,w.generatedAt,m.mergedAt,COUNT(c.id) AS chapterCount,COALESCE(SUM(LENGTH(c.content)),0) AS charCount,(SELECT COUNT(*) FROM NativeWorkMemory n WHERE n.workId=w.id) AS memoryCount FROM NativeWork w LEFT JOIN NativeWorkChapter c ON c.workId=w.id LEFT JOIN NativeWorkMerge m ON m.workId=w.id WHERE w.deletedAt IS NULL GROUP BY w.id ORDER BY w.generatedAt DESC,w.id", &[])?;
    Ok(json!({"works":rows}))
}
fn detail(db: &Connection, id: &str) -> Result<Value> {
    let mut work=one(db,"SELECT w.id,w.title,w.sourceProjectId,w.sourceProjectName,w.direction,w.generatedAt,m.mergedAt,(SELECT COUNT(*) FROM NativeWorkMemory n WHERE n.workId=w.id) AS memoryCount FROM NativeWork w LEFT JOIN NativeWorkMerge m ON m.workId=w.id WHERE w.id=? AND w.deletedAt IS NULL", &[json!(id)])?;
    let first = crate::chapter_titles::work_first(db, id)?;
    let mut chapters = query(db,"SELECT id,\"index\",title,content,1 AS version FROM NativeWorkChapter WHERE workId=? ORDER BY \"index\"", &[json!(id)])?;
    for chapter in &mut chapters { chapter["chapterNumber"] = json!(first + chapter["index"].as_i64().unwrap_or(1) - 1); chapter["title"] = json!(crate::chapter_titles::display_title(&chapter["title"])); }
    work["chapterCount"] = json!(chapters.len());
    work["charCount"] = json!(chapters.iter().map(|chapter| chapter["content"].as_str().unwrap_or("").chars().count()).sum::<usize>());
    work["chapters"] = json!(chapters);
    Ok(work)
}
