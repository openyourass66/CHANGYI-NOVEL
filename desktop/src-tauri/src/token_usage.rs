use crate::database::{execute, id, now, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

pub fn migrate(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS NativeTokenUsage (
        id TEXT PRIMARY KEY, runId TEXT NOT NULL, projectId TEXT NOT NULL, taskId TEXT NOT NULL,
        model TEXT NOT NULL, input INTEGER, output INTEGER, total INTEGER,
        pending INTEGER NOT NULL DEFAULT 0, legacy INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS NativeTokenUsage_scope ON NativeTokenUsage(projectId,taskId);
        CREATE TABLE IF NOT EXISTS NativeTokenMigration(id INTEGER PRIMARY KEY);") .map_err(|e| e.to_string())?;
    if one(
        db,
        "SELECT count(*) AS count FROM NativeTokenMigration",
        &[],
    )?["count"]
        == 0
    {
        let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
        for run in query(&tx, "SELECT r.*,p.model FROM AnalysisRun r LEFT JOIN ModelProfile p ON p.id=r.modelProfileId", &[])? {
            let usage: Value = serde_json::from_str(run["usageJson"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
            let input: Value = serde_json::from_str(run["inputRangeJson"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
            let task = input["payload"]["workflowId"].as_str().or(run["id"].as_str()).unwrap_or("");
            execute(&tx, "INSERT OR IGNORE INTO NativeTokenUsage(id,runId,projectId,taskId,model,input,output,total,legacy,createdAt) VALUES(?,?,?,?,?,?,?,?,1,?)", &[
                json!(format!("legacy-{}",run["id"].as_str().unwrap_or(""))),run["id"].clone(),run["projectId"].clone(),json!(task),json!(run["model"].as_str().unwrap_or("历史模型")),usage["promptTokens"].clone(),usage["completionTokens"].clone(),usage["totalTokens"].clone(),json!(now())])?;
        }
        execute(&tx, "INSERT INTO NativeTokenMigration VALUES(1)", &[])?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn begin(db: &Connection, run_id: &str, model: &str) -> Result<String> {
    let run = one(
        db,
        "SELECT projectId,inputRangeJson FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?;
    let input: Value =
        serde_json::from_str(run["inputRangeJson"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
    let task = input["payload"]["workflowId"].as_str().unwrap_or(run_id);
    let request_id = id();
    execute(db,"INSERT INTO NativeTokenUsage(id,runId,projectId,taskId,model,pending,createdAt) VALUES(?,?,?,?,?,1,?)", &[json!(request_id),json!(run_id),run["projectId"].clone(),json!(task),json!(model),json!(now())])?;
    Ok(request_id)
}

pub fn unscoped(db: &Connection, model: &str) -> Result<String> {
    let request_id = id();
    execute(db,"INSERT INTO NativeTokenUsage(id,runId,projectId,taskId,model,createdAt) VALUES(?,?,'',?,?,?)", &[json!(request_id),json!(request_id),json!(request_id),json!(model),json!(now())])?;
    Ok(request_id)
}

pub fn finish(db: &Connection, request_id: &str, data: &Value, provider: &str) -> Result<()> {
    let u = &data["usage"];
    let (input, output) = if provider == "anthropic" {
        // Cache reads and writes are separate input counters in Anthropic responses.
        (
            u["input_tokens"].as_u64().map(|n| {
                n + u["cache_read_input_tokens"].as_u64().unwrap_or(0)
                    + u["cache_creation_input_tokens"].as_u64().unwrap_or(0)
            }),
            u["output_tokens"].as_u64(),
        )
    } else {
        (u["prompt_tokens"].as_u64(), u["completion_tokens"].as_u64())
    };
    let total = u["total_tokens"]
        .as_u64()
        .or_else(|| input.zip(output).map(|(a, b)| a + b));
    execute(
        db,
        "UPDATE NativeTokenUsage SET input=?,output=?,total=?,pending=0 WHERE id=?",
        &[json!(input), json!(output), json!(total), json!(request_id)],
    )?;
    Ok(())
}

fn totals(rows: &[Value], model: Option<&str>) -> Value {
    let rows: Vec<_> = rows
        .iter()
        .filter(|r| model.is_none_or(|m| r["model"] == m))
        .collect();
    let sum = |key: &str| -> Option<u64> {
        let values: Vec<_> = rows.iter().filter_map(|r| r[key].as_u64()).collect();
        if values.is_empty() {
            None
        } else {
            Some(values.iter().sum())
        }
    };
    json!({"input":sum("input"),"output":sum("output"),"total":sum("total"),"requests":rows.len(),
        "unknown":rows.iter().filter(|r| (r["total"].is_null() || r["input"].is_null() || r["output"].is_null()) && r["pending"] == 0).count(),
        "pending":rows.iter().filter(|r| r["pending"] == 1).count(),
        "legacy":rows.iter().filter(|r| r["legacy"] == 1).count()})
}

pub fn summary(db: &Connection, project: Option<&str>, model: Option<&str>) -> Result<Value> {
    let mut rows = query(db, "SELECT * FROM NativeTokenUsage", &[])?;
    for row in &mut rows {
        if row["pending"] == 1 && !crate::analysis::is_processing(row["runId"].as_str().unwrap_or("")) { row["pending"] = json!(0); }
    }
    let mut runs = query(db,"SELECT r.id,r.projectId,r.status,r.updatedAt,COALESCE(json_extract(r.inputRangeJson,'$.payload.workflowId'),r.id) AS taskId,p.name AS projectName FROM AnalysisRun r LEFT JOIN NovelProject p ON p.id=r.projectId WHERE (? IS NULL OR r.projectId=?) ORDER BY r.updatedAt DESC", &[json!(project),json!(project)])?;
    runs.sort_by_key(|r| !crate::analysis::is_processing(r["id"].as_str().unwrap_or("")) && !crate::automation::live(r["taskId"].as_str().unwrap_or("")));
    let current = runs.first();
    let project = project.or_else(|| current.and_then(|r| r["projectId"].as_str()));
    let task_id = current.and_then(|r| r["taskId"].as_str()).map(str::to_string);
    let task_rows: Vec<_> = rows
        .iter()
        .filter(|r| task_id.as_ref().is_some_and(|id| r["taskId"] == *id))
        .cloned()
        .collect();
    let project_rows: Vec<_> = rows
        .iter()
        .filter(|r| project.is_some_and(|id| r["projectId"] == id))
        .cloned()
        .collect();
    let mut models: Vec<_> = rows.iter().filter_map(|r| r["model"].as_str()).collect();
    models.sort();
    models.dedup();
    let running = current.is_some_and(|r| crate::analysis::is_processing(r["id"].as_str().unwrap_or("")) || crate::automation::live(r["taskId"].as_str().unwrap_or("")));
    let project_name = project.and_then(|id| one(db,"SELECT name FROM NovelProject WHERE id=?", &[json!(id)]).ok()).map(|p|p["name"].clone());
    Ok(
        json!({"task":totals(&task_rows,model),"project":totals(&project_rows,model),"global":totals(&rows,model),"models":models,
        "taskId":task_id,"running":running,"projectId":project,"projectName":project_name,"updatedAt":now()}),
    )
}
