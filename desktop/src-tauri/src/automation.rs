use crate::{
    analysis,
    database::{execute, id, now, one, query, Result},
    model,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
};

static RUNNING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
fn running() -> &'static Mutex<HashSet<String>> {
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}
fn live(id: &str) -> bool {
    running().lock().map(|r| r.contains(id)).unwrap_or(false)
}
fn decode(row: &Value, field: &str) -> Value {
    serde_json::from_str(row[field].as_str().unwrap_or("{}")).unwrap_or(json!({}))
}
pub fn active(db: &Connection, project: &str) -> Result<bool> {
    Ok(!query(
        db,
        "SELECT id FROM NativeWorkflow WHERE projectId=? AND status='running'",
        &[json!(project)],
    )?
    .is_empty())
}
pub fn settings(db: &Connection, project: &str) -> Result<Value> {
    one(
        db,
        "SELECT id FROM NovelProject WHERE id=?",
        &[json!(project)],
    )?;
    global_settings(db)
}
pub fn global_settings(db: &Connection) -> Result<Value> {
    let row = one(
        db,
        "SELECT autoAccept,autoSynthesis FROM NativeGlobalAutomation WHERE id=1",
        &[],
    )?;
    Ok(json!({"autoAccept":row["autoAccept"]==1,"autoSynthesis":row["autoSynthesis"]==1}))
}

pub fn accept_run(db: &mut Connection, run: &str) -> Result<()> {
    for row in query(db,"SELECT id FROM MemoryProposal WHERE runId=? AND draftId IS NULL AND state='pending' ORDER BY createdAt,id", &[json!(run)])? {
        crate::proposals::accept(db,row["id"].as_str().ok_or("提案编号无效。")?)?;
    }
    Ok(())
}
fn fingerprint(db: &Connection, root: &Path, profile: &str) -> Result<Value> {
    let p = model::resolve(db, root, profile)?;
    Ok(json!({"provider":p.provider,"model":p.model,"baseUrl":p.base_url,"isLocal":p.is_local}))
}
pub fn route(
    db: &mut Connection,
    root: &Path,
    method: &str,
    parts: &[&str],
    body: &Value,
) -> Option<Result<Value>> {
    Some(match (method, parts) {
        ("GET", ["api", "settings", "automation"]) => global_settings(db),
        ("GET", ["api", "projects", project, "automation"]) => settings(db, project),
        ("PATCH", ["api", "settings", "automation"]) => (|| {
            let mut value = global_settings(db)?;
            for field in ["autoAccept", "autoSynthesis"] {
                if let Some(v) = body.get(field) {
                    if !v.is_boolean() {
                        return Err("配置必须为开关值。".into());
                    }
                    value[field] = v.clone();
                }
            }
            if body.get("sound").is_some() {
                return Err("声音提醒使用固定规则，无需配置。".into());
            }
            execute(
                db,
                "UPDATE NativeGlobalAutomation SET autoAccept=?,autoSynthesis=? WHERE id=1",
                &[value["autoAccept"].clone(), value["autoSynthesis"].clone()],
            )?;
            Ok(value)
        })(),
        ("GET", ["api", "workflows"]) => list(db),
        ("POST", ["api", "projects", project, "workflows"]) => start(db, root, project, body),
        ("POST", ["api", "workflows", workflow, "ack"]) => {
            if let Some(run) = workflow.strip_prefix("run-") {
                execute(db,"INSERT OR IGNORE INTO NativeTaskNotice(runId,status) SELECT id,status FROM AnalysisRun WHERE id=?", &[json!(run)]).map(|_|json!({"ok":true}))
            } else {
                execute(
                    db,
                    "UPDATE NativeWorkflow SET notified=1 WHERE id=?",
                    &[json!(workflow)],
                )
                .map(|_| json!({"ok":true}))
            }
        }
        ("POST", ["api", "workflows", workflow, "cancel"]) => cancel(db, workflow),
        ("POST", ["api", "workflows", workflow, "resume"]) => (|| {
            let row = one(
                db,
                "SELECT * FROM NativeWorkflow WHERE id=?",
                &[json!(workflow)],
            )?;
            if row["status"] == "done" || row["status"] == "canceled" {
                return Err("该流程已经结束。".into());
            }
            let config = decode(&row, "configJson");
            if fingerprint(
                db,
                root,
                config["profileId"].as_str().ok_or("模型不存在。")?,
            )? != config["profile"]
            {
                return Err("模型配置已改变，请重新启动并授权。".into());
            }
            execute(db,"UPDATE NativeWorkflow SET status='running',error=NULL,notified=0,updatedAt=? WHERE id=?", &[json!(now()),json!(workflow)])?;
            spawn(root.to_path_buf(), workflow.to_string());
            Ok(json!({"ok":true}))
        })(),
        _ => return None,
    })
}
fn list(db: &Connection) -> Result<Value> {
    let snapshot = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let result = list_snapshot(&snapshot)?;
    snapshot.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
fn list_snapshot(db: &Connection) -> Result<Value> {
    let mut rows = query(db,"SELECT w.*,p.name AS projectName,k.id AS workId FROM NativeWorkflow w JOIN NovelProject p ON p.id=w.projectId LEFT JOIN NativeWork k ON k.workflowId=w.id AND k.deletedAt IS NULL ORDER BY w.createdAt DESC", &[])?;
    for row in &mut rows {
        let steps = decode(row, "stepsJson");
        row["steps"] = steps.clone();
        row["planId"] = decode(row, "configJson")["planId"].clone();
        let index = row["step"].as_u64().unwrap_or(0) as usize;
        row["currentTask"] = steps.as_array().and_then(|items| items.get(index).or_else(|| items.last()))
            .map(|step| step["taskType"].clone()).unwrap_or(Value::Null);
        let runs = query(db, "SELECT id,taskType FROM AnalysisRun WHERE projectId=? AND json_extract(inputRangeJson,'$.payload.workflowId')=? ORDER BY createdAt DESC",
            &[row["projectId"].clone(),row["id"].clone()])?;
        let mut task_runs = serde_json::Map::new();
        for run in runs {
            if let Some(task) = run["taskType"].as_str() {
                if !task_runs.contains_key(task) {
                    task_runs.insert(task.to_string(), analysis::status(db, run["id"].as_str().ok_or("任务不存在。")?)?);
                }
            }
        }
        row["taskRuns"] = Value::Object(task_runs);
        row["plan"] = if let (Some(project), Some(plan)) = (row["projectId"].as_str(), row["planId"].as_str()) {
            if query(db,"SELECT id FROM ContinuationPlan WHERE id=? AND projectId=?", &[json!(plan),json!(project)])?.is_empty() {
                Value::Null
            } else { crate::continuation::plan(db, project, plan)? }
        } else { Value::Null };
        row["sound"] = json!(true);
        if row["status"] == "running" && !live(row["id"].as_str().unwrap_or("")) {
            row["status"] = json!("stalled");
        }
        row["run"] = if let Some(id) = row["runId"].as_str() {
            analysis::status(db, id)?
        } else {
            Value::Null
        };
        row.as_object_mut().unwrap().remove("configJson");
    }
    let standalone = query(db,"SELECT r.id,r.projectId,p.name AS projectName FROM AnalysisRun r JOIN NovelProject p ON p.id=r.projectId WHERE NOT EXISTS (SELECT 1 FROM NativeWorkflow w WHERE w.id=json_extract(r.inputRangeJson,'$.payload.workflowId')) AND NOT EXISTS (SELECT 1 FROM NativeTaskNotice n WHERE n.runId=r.id AND n.status=r.status) ORDER BY r.createdAt DESC LIMIT 30", &[])?;
    for row in standalone {
        let run = analysis::status(db, row["id"].as_str().ok_or("任务不存在。")?)?;
        rows.push(json!({"id":format!("run-{}",row["id"].as_str().unwrap_or("")),"projectId":row["projectId"],"projectName":row["projectName"],"kind":"single","status":run["status"],"currentTask":run["taskType"],"run":run,"notified":0,"sound":true}));
    }
    Ok(json!({"workflows":rows}))
}
pub fn start(db: &mut Connection, root: &Path, project: &str, body: &Value) -> Result<Value> {
    if active(db, project)? {
        return Err("该项目已有自动流程，请先完成或停止。".into());
    }
    if !query(
        db,
        "SELECT id FROM AnalysisRun WHERE projectId=? AND status IN ('pending','running')",
        &[json!(project)],
    )?
    .is_empty()
    {
        return Err("请先完成或取消当前任务。".into());
    }
    let profile_id = body["profileId"].as_str().ok_or("请选择模型。")?;
    let profile = fingerprint(db, root, profile_id)?;
    if profile["isLocal"] != true && body["authorized"] != true {
        return Err("请先授权本次完整自动流程。".into());
    }
    let kind = body["kind"].as_str().unwrap_or("understand");
    let mut steps = vec![];
    if kind == "understand" {
        steps.push(json!({"taskType":"chapter-extract","chapterIds":body["chapterIds"]}));
        if settings(db, project)?["autoSynthesis"] == true {
            steps.push(json!({"taskType":"book-synthesis"}));
        }
    } else if kind == "continue" {
        let plan_id = body["planId"].as_str().ok_or("请选择续写方向。")?;
        let plan = one(
            db,
            "SELECT * FROM ContinuationPlan WHERE id=? AND projectId=?",
            &[json!(plan_id), json!(project)],
        )?;
        one(
            db,
            "SELECT id FROM MemoryEntry WHERE projectId=? AND isCurrent=1 LIMIT 1",
            &[json!(project)],
        )
        .map_err(|_| "请先完成理解分析，积累故事记忆。".to_string())?;
        let outline: Value =
            serde_json::from_str(plan["outlineJson"].as_str().unwrap_or("[]")).unwrap_or(json!([]));
        if outline.as_array().is_none_or(Vec::is_empty) {
            let count = body["outlineCount"].as_u64().unwrap_or(5);
            if !(1..=30).contains(&count) {
                return Err("续写章数应为 1–30。".into());
            }
            steps.push(
                json!({"taskType":"outline","payload":{"planId":plan_id,"outlineCount":count}}),
            );
        }
        // Existing chapters are preserved; draft task only generates missing chapters.
        let count = query(
            db,
            "SELECT id FROM DraftChapter WHERE planId=?",
            &[json!(plan_id)],
        )?
        .len();
        if outline
            .as_array()
            .is_none_or(|items| items.is_empty() || count < items.len())
        {
            steps.push(json!({"taskType":"draft","payload":{"planId":plan_id}}));
        }
        for task in ["continuity-check", "draft-memory"] {
            steps.push(json!({"taskType":task,"payload":{"planId":plan_id}}));
        }
    } else {
        return Err("流程类型无效。".into());
    }
    let workflow = id();
    let config = json!({"profileId":profile_id,"authorized":body["authorized"],"profile":profile,"autoAccept":settings(db,project)?["autoAccept"],"planId":body["planId"]});
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(&tx,"INSERT INTO NativeWorkflow(id,projectId,kind,stepsJson,configJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)", &[json!(workflow),json!(project),json!(kind),json!(json!(steps).to_string()),json!(config.to_string()),json!(now()),json!(now())])?;
    let mut first = steps[0].clone();
    first["profileId"] = json!(profile_id);
    first["authorized"] = body["authorized"].clone();
    first["workflowId"] = json!(workflow);
    first["autoAccept"] = config["autoAccept"].clone();
    let result = analysis::start(&tx, root, project, &first)?;
    execute(
        &tx,
        "UPDATE NativeWorkflow SET runId=? WHERE id=?",
        &[result["runId"].clone(), json!(workflow)],
    )?;
    if kind == "continue" {
        execute(&tx,"UPDATE ContinuationPlan SET status=CASE WHEN id=? THEN 'active' WHEN status='active' THEN 'draft' ELSE status END WHERE projectId=?", &[body["planId"].clone(),json!(project)])?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    spawn(root.to_path_buf(), workflow.clone());
    Ok(json!({"workflowId":workflow,"runId":result["runId"]}))
}
fn cancel(db: &mut Connection, workflow: &str) -> Result<Value> {
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let row = one(
        &tx,
        "SELECT * FROM NativeWorkflow WHERE id=?",
        &[json!(workflow)],
    )?;
    if row["status"] == "done" {
        return Ok(json!({"ok":true}));
    }
    execute(
        &tx,
        "UPDATE NativeWorkflow SET status='canceled',updatedAt=? WHERE id=?",
        &[json!(now()), json!(workflow)],
    )?;
    execute(&tx,"UPDATE AnalysisRun SET status='canceled',canceledAt=?,finishedAt=?,updatedAt=? WHERE id=? AND status IN ('pending','running','failed')", &[json!(now()),json!(now()),json!(now()),row["runId"].clone()])?;
    execute(&tx,"UPDATE Chapter SET analysisStatus='pending' WHERE projectId=? AND analysisStatus='analyzing'", &[row["projectId"].clone()])?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"ok":true}))
}
fn spawn(root: PathBuf, workflow: String) {
    if !running()
        .lock()
        .map(|mut r| r.insert(workflow.clone()))
        .unwrap_or(false)
    {
        return;
    }
    thread::spawn(move || {
        let result = (|| {
            let mut db = crate::database::open(&root)?;
            process(&mut db, &root, &workflow)
        })();
        if let Err(error) = result {
            if let Ok(db) = crate::database::open(&root) {
                let _ = execute(&db,"UPDATE NativeWorkflow SET status='failed',error=?,updatedAt=? WHERE id=? AND status='running'", &[json!(error),json!(now()),json!(workflow)]);
            }
        }
        if let Ok(mut r) = running().lock() {
            r.remove(&workflow);
        }
    });
}
fn process(db: &mut Connection, root: &Path, workflow: &str) -> Result<()> {
    loop {
        let row = one(
            db,
            "SELECT * FROM NativeWorkflow WHERE id=?",
            &[json!(workflow)],
        )?;
        if row["status"] != "running" {
            return Ok(());
        }
        let config = decode(&row, "configJson");
        let profile_id = config["profileId"].as_str().ok_or("模型不存在。")?;
        if fingerprint(db, root, profile_id)? != config["profile"] {
            return Err("模型配置已改变，请重新发起流程并授权。".into());
        }
        let steps = decode(&row, "stepsJson");
        let index = row["step"].as_u64().unwrap_or(0) as usize;
        let Some(step) = steps.as_array().and_then(|s| s.get(index)) else {
            let tx = db.transaction().map_err(|e| e.to_string())?;
            let current = one(
                &tx,
                "SELECT * FROM NativeWorkflow WHERE id=?",
                &[json!(workflow)],
            )?;
            if current["status"] != "running" {
                return Ok(());
            }
            let finished = now();
            if current["kind"] == "continue" {
                crate::works::archive(&tx, &current, finished)?;
            }
            execute(
                &tx,
                "UPDATE NativeWorkflow SET status='done',updatedAt=? WHERE id=?",
                &[json!(finished), json!(workflow)],
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(());
        };
        let run_id = if let Some(run) = row["runId"].as_str() {
            run.to_string()
        } else {
            let tx = db.transaction().map_err(|e| e.to_string())?;
            // Recheck cancellation while holding the write transaction.
            if one(
                &tx,
                "SELECT status FROM NativeWorkflow WHERE id=?",
                &[json!(workflow)],
            )?["status"]
                != "running"
            {
                return Ok(());
            }
            let mut body = step.clone();
            body["profileId"] = json!(profile_id);
            body["authorized"] = config["authorized"].clone();
            body["workflowId"] = json!(workflow);
            body["autoAccept"] = config["autoAccept"].clone();
            let result = analysis::start(
                &tx,
                root,
                row["projectId"].as_str().ok_or("项目不存在。")?,
                &body,
            )?;
            let run = result["runId"]
                .as_str()
                .ok_or("任务创建失败。")?
                .to_string();
            execute(
                &tx,
                "UPDATE NativeWorkflow SET runId=?,updatedAt=? WHERE id=?",
                &[json!(run), json!(now()), json!(workflow)],
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            run
        };
        let state = one(
            db,
            "SELECT status FROM AnalysisRun WHERE id=?",
            &[json!(run_id)],
        )?;
        if state["status"] != "done" {
            analysis::process_managed(db, root, &run_id)?;
        }
        let state = one(
            db,
            "SELECT status,error FROM AnalysisRun WHERE id=?",
            &[json!(run_id)],
        )?;
        if state["status"] == "canceled" {
            cancel(db, workflow)?;
            return Ok(());
        }
        if state["status"] != "done" {
            return Err(state["error"]
                .as_str()
                .unwrap_or("任务失败，请继续未完成部分。")
                .into());
        }
        if step["taskType"] == "chapter-extract"
            && config["autoAccept"] != true
            && steps.as_array().is_some_and(|s| s.len() > index + 1)
        {
            let pending = query(db,"SELECT id FROM MemoryProposal WHERE runId=? AND state IN ('pending','conflicted') LIMIT 1", &[json!(run_id)])?;
            if !pending.is_empty() {
                return Err("请先审阅并采纳本次分析记忆，再继续全书统合。".into());
            }
        }
        execute(db,"UPDATE NativeWorkflow SET step=step+1,runId=NULL,updatedAt=? WHERE id=? AND status='running'", &[json!(now()),json!(workflow)])?;
    }
}
