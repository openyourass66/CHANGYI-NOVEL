use crate::{
    context,
    database::{execute, id, now, one, query, Result},
    model,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    thread,
};

static PROCESSING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
fn processing() -> &'static Mutex<HashSet<String>> {
    PROCESSING.get_or_init(|| Mutex::new(HashSet::new()))
}
pub fn is_processing(run_id: &str) -> bool {
    processing()
        .lock()
        .map(|set| set.contains(run_id))
        .unwrap_or(false)
}

pub(crate) fn process_managed(db: &mut Connection, root: &Path, run_id: &str) -> Result<()> {
    let run = one(db, "SELECT * FROM AnalysisRun WHERE id=?", &[json!(run_id)])?;
    if run["status"] == "failed" {
        let stored = stored_input(&run);
        let mut progress = progress_for(&run, stored["units"].as_array().map_or(0, Vec::len));
        let failed = progress["failedIds"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if let Some(done) = progress["doneIds"].as_array_mut() {
            done.retain(|id| !failed.contains(id));
        }
        progress["failedIds"] = json!([]);
        progress["errors"] = json!([]);
        save_progress(db, run_id, &progress)?;
    }
    processing()
        .lock()
        .map_err(|_| "任务锁不可用。")?
        .insert(run_id.into());
    let result = process(db, root, run_id);
    if let Ok(mut running) = processing().lock() {
        running.remove(run_id);
    }
    if let Err(error) = &result {
        execute(db, "UPDATE AnalysisRun SET status='failed',error=?,finishedAt=?,updatedAt=? WHERE id=? AND status!='canceled'",
            &[json!(error),json!(now()),json!(now()),json!(run_id)])?;
    }
    result
}

pub fn route(
    db: &mut Connection,
    root: &Path,
    method: &str,
    parts: &[&str],
    body: &Value,
) -> Option<Result<Value>> {
    if let ("POST", ["api", "analysis", run_id, action @ ("cancel" | "resume")]) = (method, parts) {
        if let Ok(run) = one(db, "SELECT * FROM AnalysisRun WHERE id=?", &[json!(run_id)]) {
            if let Some(workflow) = stored_input(&run)["payload"]["workflowId"].as_str() {
                return Some(
                    crate::automation::route(
                        db,
                        root,
                        "POST",
                        &["api", "workflows", workflow, action],
                        body,
                    )
                    .unwrap_or_else(|| Err("流程不存在。".into()))
                    .and_then(|_| status(db, run_id).map(|run| json!({"run":run}))),
                );
            }
        }
    }
    let result = match (method, parts) {
        ("GET", ["api", "projects", project_id, "analysis"]) => latest(db, project_id),
        ("POST", ["api", "projects", project_id, "analysis", "preview"]) => {
            preview(db, root, project_id, body)
        }
        ("POST", ["api", "projects", project_id, "analysis"]) => {
            if body["taskType"] == "chapter-extract"
                && crate::automation::settings(db, project_id)
                    .is_ok_and(|s| s["autoSynthesis"] == true)
            {
                let mut config = body.clone();
                config["kind"] = json!("understand");
                crate::automation::start(db, root, project_id, &config)
            } else {
                start(db, root, project_id, body)
            }
        }
        ("GET", ["api", "analysis", run_id]) => status(db, run_id).map(|run| json!({"run":run})),
        ("POST", ["api", "analysis", run_id, "cancel"]) => {
            cancel(db, run_id).map(|run| json!({"run":run}))
        }
        ("POST", ["api", "analysis", run_id, "resume"]) => {
            resume(db, root, run_id).map(|run| json!({"run":run}))
        }
        _ => return None,
    };
    Some(result)
}

fn latest(db: &Connection, project_id: &str) -> Result<Value> {
    one(
        db,
        "SELECT id FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    let recent=query(db,
        "SELECT id,taskType FROM AnalysisRun WHERE projectId=? AND taskType IN ('chapter-extract','book-synthesis','direction','outline','draft','continuity-check','draft-memory') ORDER BY createdAt DESC",
        &[json!(project_id)])?;
    let mut task_runs = serde_json::Map::new();
    let mut newest = None;
    for row in recent {
        let Some(task) = row["taskType"].as_str() else {
            continue;
        };
        if task_runs.contains_key(task) {
            continue;
        }
        let run = status(db, row["id"].as_str().ok_or("任务编号无效。")?)?;
        if newest.is_none() {
            newest = Some(run.clone());
        }
        task_runs.insert(task.into(), run);
    }
    Ok(json!({"run":newest,"taskRuns":task_runs}))
}

fn chapter_units(db: &Connection, project_id: &str, body: &Value) -> Result<Vec<Value>> {
    one(
        db,
        "SELECT id FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    let chapters = query(
        db,
        "SELECT id,rawTitle,content FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?;
    let selected = body["chapterIds"].as_array().map(|rows| {
        rows.iter()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>()
    });
    if let Some(selected) = &selected {
        if selected.len() != body["chapterIds"].as_array().map_or(0, Vec::len)
            || selected
                .iter()
                .any(|id| !chapters.iter().any(|row| row["id"] == **id))
        {
            return Err("章节范围包含重复或不属于当前项目的章节。".into());
        }
    }
    let units = chapters
        .into_iter()
        .filter(|row| {
            selected
                .as_ref()
                .is_none_or(|set| set.contains(row["id"].as_str().unwrap_or("")))
        })
        .collect::<Vec<_>>();
    if units.is_empty() {
        return Err("没有可分析的章节。".into());
    }
    Ok(units)
}

fn task_type(body: &Value) -> Result<&str> {
    let task = body["taskType"].as_str().unwrap_or("chapter-extract");
    if ![
        "chapter-extract",
        "book-synthesis",
        "direction",
        "outline",
        "draft",
        "continuity-check",
        "draft-memory",
    ]
    .contains(&task)
    {
        return Err("不支持的模型任务类型。".into());
    }
    Ok(task)
}

fn task_label(task: &str) -> &str {
    match task {
        "book-synthesis" => "全书统合",
        "direction" => "生成续写方向",
        "outline" => "生成章纲",
        "draft" => "生成草稿",
        "continuity-check" => "检查连续性",
        "draft-memory" => "提取记忆变化",
        _ => "逐章抽取",
    }
}
fn unit_label(task: &str) -> &str {
    if matches!(
        task,
        "chapter-extract" | "draft" | "continuity-check" | "draft-memory"
    ) {
        "章节"
    } else {
        "项"
    }
}
fn task_note(task: &str) -> &str {
    match task {
        "book-synthesis" => {
            "统合已有记忆与最近原文，产出全书概要、结局状态、未决线索和续写约束；结果标记为推断。"
        }
        "direction" => "依据已确认记忆与最近原文，提出 3 个候选续写方向，供作者择一。",
        "outline" => "依据选定方向与已确认记忆，生成接下来若干章的章纲。",
        "draft" => "依据已选定的方向和章纲逐章生成草稿，结合本方向此前正文的相关片段作为前情；正文须为 1800–3500 字，不含空白。",
        "continuity-check" => "逐章核对草稿与记忆、原文及同方向其他续写章节是否自洽；相关片段将发送给模型，节选之外的内容不在检查范围内；重新检查会替换上一轮问题。",
        "draft-memory" => {
            "从草稿提取新事实和变化，同时参考本方向此前正文避免重复；相关片段将发送给模型。作者审阅后才写入记忆；重新提取会替换尚未处理的提案。"
        }
        _ => "逐章抽取：章节笔记、事件、人物（含认知）、设定、悬念与术语，每条附原文出处。",
    }
}

fn task_units(db: &Connection, project_id: &str, body: &Value, task: &str) -> Result<Vec<Value>> {
    if task == "chapter-extract" {
        chapter_units(db, project_id, body)
    } else {
        one(
            db,
            "SELECT id FROM NovelProject WHERE id=?",
            &[json!(project_id)],
        )?;
        if query(
            db,
            "SELECT id FROM MemoryEntry WHERE projectId=? AND isCurrent=1 LIMIT 1",
            &[json!(project_id)],
        )?
        .is_empty()
        {
            return Err("还没有记忆条目可供参考，请先运行「逐章抽取」。".into());
        }
        if matches!(task, "continuity-check" | "draft-memory") {
            let payload = &body["payload"];
            let drafts = if let Some(draft_id) = payload["draftId"].as_str() {
                vec![one(
                    db,
                    "SELECT * FROM DraftChapter WHERE id=? AND projectId=?",
                    &[json!(draft_id), json!(project_id)],
                )?]
            } else {
                let plan_id = resolve_plan_id(db, project_id, payload)?;
                query(
                    db,
                    "SELECT * FROM DraftChapter WHERE projectId=? AND planId=? ORDER BY \"index\"",
                    &[json!(project_id), json!(plan_id)],
                )?
            };
            if drafts.is_empty() {
                return Err("这个方向还没有草稿，请先运行「生成草稿」。".into());
            }
            let prefix = if task == "continuity-check" {
                "check"
            } else {
                "memo"
            };
            return drafts.into_iter().map(|row| { let number = crate::chapter_titles::draft_number(db, &row)?; Ok(json!({
                "id":format!("{prefix}-{}",row["id"].as_str().unwrap_or("")),
                "rawTitle":format!("第 {} 章 · {}",number,crate::chapter_titles::display_title(&row["title"])),
                "content":row["content"],"index":row["index"],"planId":row["planId"],"outlineItemJson":row["outlineItemJson"]
            })) }).collect::<Result<Vec<_>>>();
        }
        if task == "draft" {
            let plan_id = resolve_plan_id(db, project_id, &body["payload"])?;
            let plan = one(
                db,
                "SELECT outlineJson FROM ContinuationPlan WHERE id=?",
                &[json!(plan_id)],
            )?;
            let outline: Value = serde_json::from_str(plan["outlineJson"].as_str().unwrap_or("[]"))
                .unwrap_or(json!([]));
            let items = outline
                .as_array()
                .filter(|rows| !rows.is_empty())
                .ok_or("这个方向还没有章纲，请先运行「生成章纲」。")?;
            let selected = body["payload"]["outlineIndex"].as_u64();
            let existing = query(
                db,
                "SELECT \"index\" FROM DraftChapter WHERE projectId=? AND planId=?",
                &[json!(project_id), json!(plan_id)],
            )?
            .into_iter()
            .filter_map(|row| row["index"].as_u64())
            .collect::<HashSet<_>>();
            let first_number = crate::chapter_titles::plan_first(db, &plan_id)?;
            crate::chapter_titles::save_plan(db, &plan_id, first_number)?;
            let units=items.iter().enumerate().filter_map(|(i,item)|{
                let index=item["index"].as_u64().unwrap_or((i+1) as u64);
                if selected.is_some_and(|value|value!=index) || (selected.is_none() && existing.contains(&index)){return None;}
                let title=crate::chapter_titles::display_title(&item["title"]);
                let number=first_number + index as i64 - 1;
                Some(json!({"id":format!("draft-{index}"),"rawTitle":format!("第 {number} 章 · {title}"),
                    "content":item["summary"],"index":index}))
            }).collect::<Vec<_>>();
            if units.is_empty() {
                return Err(if selected.is_some() {
                    "章纲里没有指定章节。"
                } else {
                    "章纲里的每一章都已经有草稿了。"
                }
                .into());
            }
            return Ok(units);
        }
        if task == "outline" {
            let plan_id = resolve_plan_id(db, project_id, &body["payload"])?;
            if !query(
                db,
                "SELECT id FROM DraftChapter WHERE planId=? LIMIT 1",
                &[json!(plan_id)],
            )?
            .is_empty()
            {
                return Err("这个方向已有草稿，不能直接重生成章纲。请先导出需要保留的草稿，再删除该方向的草稿后重试。".into());
            }
        }
        let (unit_id, label) = match task {
            "direction" => ("directions", "续写方向"),
            "outline" => ("outline", "章纲"),
            _ => ("synthesis", "全书统合"),
        };
        Ok(vec![json!({"id":unit_id,"rawTitle":label,"content":""})])
    }
}

fn resolve_plan_id(db: &Connection, project_id: &str, payload: &Value) -> Result<String> {
    if let Some(plan_id) = payload["planId"].as_str() {
        one(
            db,
            "SELECT id FROM ContinuationPlan WHERE id=? AND projectId=?",
            &[json!(plan_id), json!(project_id)],
        )?;
        Ok(plan_id.into())
    } else {
        let rows=query(db,"SELECT id FROM ContinuationPlan WHERE projectId=? AND status='active' ORDER BY updatedAt DESC LIMIT 1",
            &[json!(project_id)])?;
        rows.first()
            .and_then(|row| row["id"].as_str())
            .map(str::to_string)
            .ok_or("请先选定一个续写方向。".into())
    }
}

fn preview(db: &Connection, root: &Path, project_id: &str, body: &Value) -> Result<Value> {
    let task = task_type(body)?;
    let profile_id = body["profileId"].as_str().ok_or("请选择模型档案。")?;
    let profile = model::resolve(db, root, profile_id)?;
    let units = task_units(db, project_id, body, task)?;
    let (total, sample) = if task != "chapter-extract" {
        let ctx = context::build(
            db,
            project_id,
            if task == "book-synthesis" {
                1
            } else if task == "draft" {
                3
            } else {
                2
            },
        )?;
        if task == "outline" {
            let plan_id = resolve_plan_id(db, project_id, &body["payload"])?;
            let plan = one(
                db,
                "SELECT direction,summary FROM ContinuationPlan WHERE id=?",
                &[json!(plan_id)],
            )?;
            let direction = plan["direction"].as_str().unwrap_or("");
            (
                ctx.total_chars + direction.encode_utf16().count(),
                format!("【已选定的续写方向】\n{direction}"),
            )
        } else if matches!(task, "draft" | "continuity-check" | "draft-memory") {
            let mut total = 0;
            for unit in &units {
                let plan_id = if let Some(plan) = unit["planId"].as_str() {
                    plan.to_string()
                } else {
                    resolve_plan_id(db, project_id, &body["payload"])?
                };
                let plan = one(db, "SELECT direction,summary,outlineJson FROM ContinuationPlan WHERE id=? AND projectId=?", &[json!(plan_id),json!(project_id)])?;
                let focus = format!("{}\n{}\n{}", plan, unit["outlineItemJson"], unit["content"]);
                let context = context::build_for(
                    db,
                    project_id,
                    if task == "draft-memory" { 1 } else { 3 },
                    &focus,
                )?;
                let history = context::draft_history(
                    db,
                    project_id,
                    &plan_id,
                    unit["index"].as_i64().unwrap_or(1),
                    task == "continuity-check",
                    &focus,
                )?;
                total += context.total_chars
                    + history.text.encode_utf16().count()
                    + unit["content"]
                        .as_str()
                        .unwrap_or("")
                        .encode_utf16()
                        .count()
                    + plan.to_string().encode_utf16().count();
                if task != "draft" {
                    total += context
                        .memories
                        .iter()
                        .map(|row| row.to_string().encode_utf16().count())
                        .sum::<usize>();
                } else {
                    // 批量写作时后章会接收本轮新生成的前章正文。
                    total += 16000usize.saturating_sub(history.text.encode_utf16().count());
                }
            }
            (
                total,
                format!(
                    "{}\n{}",
                    units[0]["rawTitle"],
                    units[0]["content"].as_str().unwrap_or("")
                ),
            )
        } else {
            (ctx.total_chars, ctx.memory_sample)
        }
    } else {
        (
            units
                .iter()
                .map(|row| row["content"].as_str().unwrap_or("").encode_utf16().count())
                .sum(),
            units[0]["content"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(400)
                .collect::<String>(),
        )
    };
    let provider_label = match profile.provider.as_str() {
        "openai-compatible" => "OpenAI 兼容",
        "anthropic" => "Anthropic",
        "ollama" => "Ollama",
        "lmstudio" => "LM Studio",
        _ => &profile.provider,
    };
    Ok(
        json!({"preview":{"taskType":task,"taskLabel":task_label(task),"provider":profile.provider,
        "providerLabel":provider_label,"model":profile.model,"isLocal":profile.is_local,
        "unitCount":units.len(),"unitLabel":unit_label(task),"totalChars":total,
        "estimatedPromptChars":total+units.len()*900,
        "sampleText":sample,"note":if task=="chapter-extract" && crate::automation::settings(db,project_id)?["autoSynthesis"]==true {
            "本次授权包含逐章分析和随后自动执行的全书统合；所选章节原文、已有记忆、最近原文及本次产生的分析记忆将发送给此模型。整个流程完成后提醒一次。"
        } else {task_note(task)}}}),
    )
}

fn seed(total: usize) -> Value {
    json!({"batchIndex":0,"batchTotal":total.div_ceil(4),"unitsDone":0,"unitsTotal":total,
        "produced":0,"errors":[],"doneIds":[],"failedIds":[],"currentUnitId":null,"currentLabel":null})
}

pub(crate) fn start(db: &Connection, root: &Path, project_id: &str, body: &Value) -> Result<Value> {
    let task = task_type(body)?;
    let profile_id = body["profileId"].as_str().ok_or("请选择模型档案。")?;
    let profile = model::resolve(db, root, profile_id)?;
    if !profile.is_local && body["authorized"] != true {
        return Err("远端模型需要用户授权后才能发送原文。".into());
    }
    let chapters = task_units(db, project_id, body, task)?;
    if !query(
        db,
        "SELECT id FROM AnalysisRun WHERE projectId=? AND status IN ('pending','running') LIMIT 1",
        &[json!(project_id)],
    )?
    .is_empty()
    {
        return Err("该项目已有运行中的任务，请先完成或取消。".into());
    }
    let units = chapters
        .iter()
        .map(|row| {
            json!({"id":row["id"],"label":row["rawTitle"],
        "chapterId":if task=="chapter-extract"{row["id"].clone()}else{Value::Null}})
        })
        .collect::<Vec<_>>();
    let mut payload = if task == "chapter-extract" {
        json!({"chapterIds":body["chapterIds"]})
    } else {
        body["payload"]
            .as_object()
            .map(|_| body["payload"].clone())
            .unwrap_or(json!({}))
    };
    if matches!(task, "chapter-extract" | "book-synthesis") {
        payload["autoAccept"] = if body["workflowId"].is_null() {
            crate::automation::settings(db, project_id)?["autoAccept"].clone()
        } else {
            body["autoAccept"].clone()
        };
    }
    if !body["workflowId"].is_null() {
        payload["workflowId"] = body["workflowId"].clone();
    } else if crate::automation::active(db, project_id)? {
        return Err("自动流程正在运行，请先停止流程。".into());
    }
    let stored = json!({"payload":payload,"units":units});
    let run_id = id();
    let at = now();
    execute(db,"INSERT INTO AnalysisRun(id,projectId,taskType,inputRangeJson,modelProfileId,promptVersion,status,usageJson,progressJson,authorizedAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'pending','{}',?,?,?,?)",
        &[json!(run_id),json!(project_id),json!(task),json!(stored.to_string()),json!(profile_id),
            json!(if matches!(task,"outline"|"draft"){format!("{task}@2")}else{format!("{task}@1")}),json!(seed(units.len()).to_string()),
            if profile.is_local{Value::Null}else{json!(at)},json!(at),json!(at)])?;
    if body["workflowId"].is_null() {
        spawn(root.to_path_buf(), run_id.clone());
    }
    Ok(json!({"runId":run_id}))
}

fn spawn(root: PathBuf, run_id: String) {
    let Ok(mut running) = processing().lock() else {
        return;
    };
    if !running.insert(run_id.clone()) {
        return;
    }
    thread::spawn(move || {
        let result = (|| -> Result<()> {
            let mut db = crate::database::open(&root)?;
            process(&mut db, &root, &run_id)
        })();
        if let Err(error) = result {
            if let Ok(db) = crate::database::open(&root) {
                let _=execute(&db,"UPDATE AnalysisRun SET status='failed',error=?,finishedAt=?,updatedAt=? WHERE id=? AND status!='canceled'",
                    &[json!(error),json!(now()),json!(now()),json!(run_id)]);
            }
        }
        if let Ok(mut running) = processing().lock() {
            running.remove(&run_id);
        }
    });
}

fn parse(value: &Value, field: &str) -> Value {
    serde_json::from_str(value[field].as_str().unwrap_or("{}")).unwrap_or(json!({}))
}

fn stored_input(run: &Value) -> Value {
    let raw = parse(run, "inputRangeJson");
    if raw["units"].is_array() {
        return raw;
    }
    let ids = raw["chapterIds"].as_array().cloned().unwrap_or_default();
    let units = ids
        .iter()
        .filter_map(Value::as_str)
        .map(|id| json!({"id":id,"label":id,"chapterId":id}))
        .collect::<Vec<_>>();
    json!({"payload":{"chapterIds":ids},"units":units})
}

fn progress_for(run: &Value, total: usize) -> Value {
    let raw = parse(run, "progressJson");
    let mut progress = seed(total);
    if let Some(object) = raw.as_object() {
        for (key, value) in object {
            if progress.get(key).is_some() {
                progress[key] = value.clone();
            }
        }
    }
    for field in ["doneIds", "failedIds", "errors"] {
        if !progress[field].is_array() {
            progress[field] = json!([]);
        }
    }
    if !raw["produced"].is_number() && raw["proposals"].is_number() {
        progress["produced"] = raw["proposals"].clone();
    }
    progress["unitsTotal"] = json!(total);
    progress["batchTotal"] = json!(total.div_ceil(4));
    progress
}

pub(crate) fn status(db: &Connection, run_id: &str) -> Result<Value> {
    let run = one(db, "SELECT * FROM AnalysisRun WHERE id=?", &[json!(run_id)])?;
    let stored = stored_input(&run);
    let units = stored["units"].as_array().cloned().unwrap_or_default();
    let mut progress = progress_for(&run, units.len());
    let done = progress["doneIds"].as_array().cloned().unwrap_or_default();
    let failed = progress["failedIds"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    progress["unitsDone"] = json!(done.len());
    let chapter_rows = query(
        db,
        "SELECT id,rawTitle,analysisStatus FROM Chapter WHERE projectId=?",
        &[run["projectId"].clone()],
    )?;
    let chapters = chapter_rows
        .into_iter()
        .filter_map(|row| Some((row["id"].as_str()?.to_string(), row)))
        .collect::<HashMap<_, _>>();
    let live = run["status"] == "running"
        && processing()
            .lock()
            .map(|set| set.contains(run_id))
            .unwrap_or(false);
    let stalled = (run["status"] == "running" || run["status"] == "pending")
        && !processing()
            .lock()
            .map(|set| set.contains(run_id))
            .unwrap_or(false);
    if !live {
        progress["currentUnitId"] = Value::Null;
        progress["currentLabel"] = Value::Null;
    }
    let unit_views=units.iter().enumerate().map(|(i,unit)|{
        let chapter_id=unit["chapterId"].as_str();
        let chapter=chapter_id.and_then(|id|chapters.get(id));
        let unit_id=unit["id"].as_str().unwrap_or("");
        let unit_status=if live && progress["currentUnitId"]==unit_id {"analyzing"}
            else if failed.iter().any(|value|value==unit_id) {"failed"}
            else if done.iter().any(|value|value==unit_id) {"done"}
            else {chapter.and_then(|row|row["analysisStatus"].as_str()).unwrap_or("pending")};
        json!({"id":unit["id"],"index":i+1,"label":chapter.map(|row|&row["rawTitle"]).unwrap_or(&unit["label"]),
            "chapterId":unit["chapterId"],"status":unit_status})
    }).collect::<Vec<_>>();
    Ok(
        json!({"id":run["id"],"projectId":run["projectId"],"taskType":run["taskType"],
        "taskLabel":task_label(run["taskType"].as_str().unwrap_or("")),"unitLabel":if run["taskType"]=="chapter-extract" || run["taskType"]=="draft"{"章"}else{"项"},"status":if stalled{"stalled"}else{run["status"].as_str().unwrap_or("failed")},
        "progress":progress,"usage":parse(&run,"usageJson"),"error":run["error"],
        "promptVersion":run["promptVersion"],"authorizedAt":run["authorizedAt"],
        "createdAt":run["createdAt"],"startedAt":run["startedAt"],"finishedAt":run["finishedAt"],
        "payload":stored["payload"],"units":unit_views}),
    )
}

fn cancel(db: &Connection, run_id: &str) -> Result<Value> {
    let run = one(db, "SELECT * FROM AnalysisRun WHERE id=?", &[json!(run_id)])?;
    let progress = parse(&run, "progressJson");
    if let Some(chapter_id) = progress["currentUnitId"].as_str() {
        execute(db,"UPDATE Chapter SET analysisStatus='pending' WHERE id=? AND projectId=? AND analysisStatus='analyzing'",
            &[json!(chapter_id),run["projectId"].clone()])?;
    }
    execute(
        db,
        "UPDATE AnalysisRun SET status='canceled',canceledAt=?,finishedAt=?,updatedAt=? WHERE id=?",
        &[json!(now()), json!(now()), json!(now()), json!(run_id)],
    )?;
    status(db, run_id)
}

fn resume(db: &Connection, root: &Path, run_id: &str) -> Result<Value> {
    let run = one(db, "SELECT * FROM AnalysisRun WHERE id=?", &[json!(run_id)])?;
    if processing()
        .lock()
        .map(|set| set.contains(run_id))
        .unwrap_or(false)
    {
        return status(db, run_id);
    }
    if run["status"] == "done" || run["status"] == "canceled" {
        return status(db, run_id);
    }
    if run["status"] == "failed" {
        let stored = stored_input(&run);
        let mut progress = progress_for(&run, stored["units"].as_array().map_or(0, Vec::len));
        let failed = progress["failedIds"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if failed.is_empty() {
            return Err("没有可安全重试的失败章节，请重新发起任务。".into());
        }
        if let Some(done) = progress["doneIds"].as_array_mut() {
            done.retain(|id| !failed.contains(id));
        }
        progress["failedIds"] = json!([]);
        progress["errors"] = json!([]);
        progress["currentUnitId"] = Value::Null;
        progress["currentLabel"] = Value::Null;
        execute(db,"UPDATE AnalysisRun SET status='running',error=NULL,progressJson=?,updatedAt=? WHERE id=?",
            &[json!(progress.to_string()),json!(now()),json!(run_id)])?;
    }
    spawn(root.to_path_buf(), run_id.to_string());
    status(db, run_id)
}

fn save_progress(db: &Connection, run_id: &str, progress: &Value) -> Result<()> {
    execute(
        db,
        "UPDATE AnalysisRun SET progressJson=?,updatedAt=? WHERE id=?",
        &[json!(progress.to_string()), json!(now()), json!(run_id)],
    )?;
    Ok(())
}

pub(crate) fn process(db: &mut Connection, root: &Path, run_id: &str) -> Result<()> {
    let run = one(db, "SELECT * FROM AnalysisRun WHERE id=?", &[json!(run_id)])?;
    if run["status"] == "canceled" {
        return Ok(());
    }
    let profile_id = run["modelProfileId"].as_str().ok_or("模型档案不存在。")?;
    let profile = model::resolve(db, root, profile_id)?;
    let stored = stored_input(&run);
    if !profile.is_local && run["authorizedAt"].is_null() {
        return Err("模型档案已改为远端服务，请重新发起任务并授权。".into());
    }
    let units = stored["units"].as_array().cloned().unwrap_or_default();
    let mut progress = progress_for(&run, units.len());
    execute(db,"UPDATE AnalysisRun SET status='running',startedAt=COALESCE(startedAt,?),error=NULL,updatedAt=? WHERE id=?",
        &[json!(now()),json!(now()),json!(run_id)])?;
    let mut usage = parse(&run, "usageJson");
    for (index, unit) in units.iter().enumerate() {
        let state = one(
            db,
            "SELECT status FROM AnalysisRun WHERE id=?",
            &[json!(run_id)],
        )?;
        if state["status"] == "canceled" {
            return Ok(());
        }
        let unit_id = unit["id"].as_str().ok_or("任务章节无效。")?;
        if progress["doneIds"]
            .as_array()
            .is_some_and(|items| items.iter().any(|value| value == unit_id))
        {
            continue;
        }
        let chapter = if run["taskType"] == "chapter-extract" {
            Some(one(
                db,
                "SELECT * FROM Chapter WHERE id=? AND projectId=?",
                &[json!(unit_id), run["projectId"].clone()],
            )?)
        } else {
            None
        };
        progress["batchIndex"] = json!(index / 4 + 1);
        progress["currentUnitId"] = json!(unit_id);
        progress["currentLabel"] = unit["label"].clone();
        save_progress(db, run_id, &progress)?;
        if chapter.is_some() {
            execute(
                db,
                "UPDATE Chapter SET analysisStatus='analyzing' WHERE id=?",
                &[json!(unit_id)],
            )?;
        }
        let project_id = run["projectId"].as_str().ok_or("任务项目无效。")?;
        let outcome = match run["taskType"].as_str().unwrap_or("") {
            "chapter-extract" => run_chapter(
                db,
                &profile,
                run_id,
                chapter.as_ref().ok_or("章节不存在。")?,
            ),
            "book-synthesis" => run_book(db, &profile, run_id, project_id),
            "direction" => run_direction(db, &profile, run_id, project_id),
            "outline" => run_outline(db, &profile, run_id, project_id, &stored["payload"]),
            "draft" => run_draft(
                db,
                &profile,
                run_id,
                project_id,
                unit_id,
                &stored["payload"],
            ),
            "continuity-check" => {
                crate::draft_tasks::run(db, &profile, run_id, project_id, unit_id, true)
            }
            "draft-memory" => {
                crate::draft_tasks::run(db, &profile, run_id, project_id, unit_id, false)
            }
            _ => Err("未知任务类型。".into()),
        };
        let state = one(
            db,
            "SELECT status FROM AnalysisRun WHERE id=?",
            &[json!(run_id)],
        )?;
        if state["status"] == "canceled" {
            return Ok(());
        }
        match outcome {
            Ok((produced, one_usage)) => {
                if stored["payload"]["autoAccept"] == true {
                    crate::automation::accept_run(db, run_id)?;
                }
                progress["produced"] =
                    json!(progress["produced"].as_u64().unwrap_or(0) + produced as u64);
                for field in ["promptTokens", "completionTokens", "totalTokens"] {
                    let total =
                        usage[field].as_u64().unwrap_or(0) + one_usage[field].as_u64().unwrap_or(0);
                    usage[field] = json!(total);
                }
                if chapter.is_some() {
                    execute(
                        db,
                        "UPDATE Chapter SET analysisStatus='done' WHERE id=?",
                        &[json!(unit_id)],
                    )?;
                }
            }
            Err(error) => {
                progress["errors"]
                    .as_array_mut()
                    .ok_or("任务进度损坏。")?
                    .push(json!(format!(
                        "《{}》：{error}",
                        unit["label"].as_str().unwrap_or("")
                    )));
                progress["failedIds"]
                    .as_array_mut()
                    .ok_or("任务进度损坏。")?
                    .push(json!(unit_id));
                if chapter.is_some() {
                    execute(
                        db,
                        "UPDATE Chapter SET analysisStatus='failed' WHERE id=?",
                        &[json!(unit_id)],
                    )?;
                }
            }
        }
        progress["doneIds"]
            .as_array_mut()
            .ok_or("任务进度损坏。")?
            .push(json!(unit_id));
        progress["unitsDone"] = json!(progress["doneIds"].as_array().map_or(0, Vec::len));
        progress["currentUnitId"] = Value::Null;
        progress["currentLabel"] = Value::Null;
        save_progress(db, run_id, &progress)?;
        execute(
            db,
            "UPDATE AnalysisRun SET usageJson=?,updatedAt=? WHERE id=?",
            &[json!(usage.to_string()), json!(now()), json!(run_id)],
        )?;
        if run["taskType"] == "draft" && !progress["failedIds"].as_array().is_none_or(Vec::is_empty)
        {
            break;
        }
    }
    let failed = progress["failedIds"]
        .as_array()
        .is_some_and(|items| !items.is_empty());
    let error = progress["errors"]
        .as_array()
        .filter(|items| !items.is_empty())
        .map(|items| {
            items
                .iter()
                .take(8)
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n")
        });
    execute(db,"UPDATE AnalysisRun SET status=?,progressJson=?,usageJson=?,error=?,finishedAt=?,updatedAt=? WHERE id=? AND status!='canceled'",
        &[json!(if failed{"failed"}else{"done"}),json!(progress.to_string()),json!(usage.to_string()),
            json!(error),json!(now()),json!(now()),json!(run_id)])?;
    Ok(())
}

fn citation(chapter: &Value, excerpt: &str) -> Option<Value> {
    let content = chapter["content"].as_str()?;
    let byte_start = content.find(excerpt)?;
    let start = content[..byte_start].encode_utf16().count();
    Some(
        json!({"chapterId":chapter["id"],"excerpt":excerpt,"startOffset":start,
        "endOffset":start+excerpt.encode_utf16().count()}),
    )
}

fn proposal(
    db: &Connection,
    run_id: &str,
    chapter: &Value,
    category: &str,
    key: &str,
    title: &str,
    content: &str,
    status: &str,
    excerpts: &[String],
) -> Result<()> {
    if content.trim().is_empty() {
        return Ok(());
    }
    let project_id = chapter["projectId"].as_str().ok_or("章节项目无效。")?;
    let existing=query(db,"SELECT id,isUserEdited FROM MemoryEntry WHERE projectId=? AND category=? AND key=? AND isCurrent=1 ORDER BY updatedAt DESC LIMIT 1",
        &[json!(project_id),json!(category),json!(key)])?.into_iter().next();
    let target = existing
        .as_ref()
        .map(|row| row["id"].clone())
        .unwrap_or(Value::Null);
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
    let citations = excerpts
        .iter()
        .filter_map(|excerpt| citation(chapter, excerpt))
        .collect::<Vec<_>>();
    execute(db,"INSERT INTO MemoryProposal(id,projectId,runId,chapterId,kind,category,key,title,content,status,citationsJson,targetEntryId,reason,state,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)",
        &[json!(id()),json!(project_id),json!(run_id),chapter["id"].clone(),json!(kind),
            json!(category),json!(key),json!(title),json!(content),json!(status),json!(json!(citations).to_string()),
            target,json!(if kind=="conflict"{Some("目标条目已人工修改，需人工裁决。")}else{None}),json!(now()),json!(now())])?;
    Ok(())
}

fn run_chapter(
    db: &mut Connection,
    profile: &model::Profile,
    run_id: &str,
    chapter: &Value,
) -> Result<(usize, Value)> {
    let system="你是一名严谨的小说文本分析师。唯一依据是章节原文。原文即正典，不得编造。每项结论必须附有逐字出现的 excerpt。人物认知区分已知、误信、未知。";
    let prompt=format!("章节标题：{}\n请只输出 JSON：{{\"chapterNote\":{{\"summary\":string,\"excerpt\":string}},\"events\":[{{\"description\":string,\"excerpt\":string}}],\"characters\":[{{\"name\":string,\"state\":string,\"knowledge\":[{{\"infoItem\":string,\"relation\":\"known\"|\"misbelieved\"|\"unknown\",\"excerpt\":string}}],\"excerpt\":string}}],\"settings\":[{{\"name\":string,\"detail\":string,\"excerpt\":string}}],\"threads\":[{{\"title\":string,\"detail\":string,\"state\":\"open\"|\"advanced\"|\"resolved\"|\"uncertain\",\"excerpt\":string}}],\"glossary\":[{{\"term\":string,\"definition\":string,\"excerpt\":string}}]}}\n章节原文：\n———\n{}\n———",
        chapter["rawTitle"].as_str().unwrap_or(""),chapter["content"].as_str().unwrap_or(""));
    let (output, usage) = model::request_tracked(
        db,
        run_id,
        profile,
        system,
        &prompt,
        4096,
        "chapter-extract",
    )?;
    if one(
        db,
        "SELECT status FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?["status"]
        == "canceled"
    {
        return Err("任务已取消。".into());
    }
    let note = &output["chapterNote"];
    let summary = note["summary"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("模型未生成章节笔记。")?;
    let excerpt = note["excerpt"]
        .as_str()
        .filter(|s| chapter["content"].as_str().unwrap_or("").contains(s))
        .ok_or("章节笔记缺少有效原文出处。")?;
    let events = output["events"].as_array().cloned().unwrap_or_default();
    let event_lines = events
        .iter()
        .enumerate()
        .filter_map(|(i, item)| {
            Some(format!(
                "{}. {}（依据：{}）",
                i + 1,
                item["description"].as_str()?,
                item["excerpt"].as_str()?
            ))
        })
        .collect::<Vec<_>>();
    let mut note_content = summary.to_string();
    if !event_lines.is_empty() {
        note_content.push_str("\n\n");
        note_content.push_str(&event_lines.join("\n"));
    }
    let mut note_excerpts = vec![excerpt.to_string()];
    note_excerpts.extend(
        events
            .iter()
            .filter_map(|item| item["excerpt"].as_str().map(str::to_string)),
    );
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let mut count = 0usize;
    proposal(
        &tx,
        run_id,
        chapter,
        "chapter-note",
        &format!("ch:{}", chapter["id"].as_str().unwrap_or("")),
        &format!("笔记：{}", chapter["rawTitle"].as_str().unwrap_or("")),
        &note_content,
        "confirmed",
        &note_excerpts,
    )?;
    count += 1;
    let relation = |value: &str| match value {
        "known" => "已知",
        "misbelieved" => "误信",
        "unknown" => "未知",
        _ => "未知",
    };
    for item in output["characters"]
        .as_array()
        .into_iter()
        .flatten()
        .take(40)
    {
        let Some(name) = item["name"].as_str().filter(|s| !s.trim().is_empty()) else {
            continue;
        };
        let mut content = item["state"].as_str().unwrap_or("").trim().to_string();
        let knowledge = item["knowledge"].as_array().cloned().unwrap_or_default();
        if !knowledge.is_empty() {
            content.push_str("\n\n认知：\n");
            content.push_str(
                &knowledge
                    .iter()
                    .filter_map(|row| {
                        Some(format!(
                            "- {}（{}）",
                            row["infoItem"].as_str()?,
                            relation(row["relation"].as_str().unwrap_or(""))
                        ))
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
        if content.trim().is_empty() {
            continue;
        }
        let mut excerpts = item["excerpt"]
            .as_str()
            .map(|s| vec![s.to_string()])
            .unwrap_or_default();
        excerpts.extend(
            knowledge
                .iter()
                .filter_map(|row| row["excerpt"].as_str().map(str::to_string)),
        );
        proposal(
            &tx,
            run_id,
            chapter,
            "character",
            name,
            name,
            &content,
            "confirmed",
            &excerpts,
        )?;
        count += 1;
    }
    for item in output["settings"].as_array().into_iter().flatten().take(40) {
        if let (Some(name), Some(detail)) = (item["name"].as_str(), item["detail"].as_str()) {
            proposal(
                &tx,
                run_id,
                chapter,
                "story-bible",
                name,
                name,
                detail,
                "confirmed",
                &item["excerpt"]
                    .as_str()
                    .map(|s| vec![s.to_string()])
                    .unwrap_or_default(),
            )?;
            count += 1;
        }
    }
    for item in output["threads"].as_array().into_iter().flatten().take(40) {
        if let (Some(title), Some(detail)) = (item["title"].as_str(), item["detail"].as_str()) {
            let status = match item["state"].as_str() {
                Some("advanced") => "advanced",
                Some("resolved") => "resolved",
                Some("uncertain") => "uncertain",
                _ => "open",
            };
            proposal(
                &tx,
                run_id,
                chapter,
                "thread",
                title,
                title,
                detail,
                status,
                &item["excerpt"]
                    .as_str()
                    .map(|s| vec![s.to_string()])
                    .unwrap_or_default(),
            )?;
            count += 1;
        }
    }
    for item in output["glossary"].as_array().into_iter().flatten().take(40) {
        if let (Some(term), Some(definition)) = (item["term"].as_str(), item["definition"].as_str())
        {
            proposal(
                &tx,
                run_id,
                chapter,
                "glossary",
                term,
                term,
                definition,
                "confirmed",
                &item["excerpt"]
                    .as_str()
                    .map(|s| vec![s.to_string()])
                    .unwrap_or_default(),
            )?;
            count += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((count, usage))
}

fn run_book(
    db: &mut Connection,
    profile: &model::Profile,
    run_id: &str,
    project_id: &str,
) -> Result<(usize, Value)> {
    let ctx = context::build(db, project_id, 1)?;
    if ctx.memory_count == 0 {
        return Err("还没有记忆条目可供参考，请先运行「逐章抽取」。".into());
    }
    let system="你是一名严谨的小说编辑，负责在全书抽取结果之上做统合判断。唯一依据是章节标题、故事记忆与最近原文。不得引入之外的设定、人物或情节；严格区分明述与推断；结局状态只描述文本已到达的状态；拿不准的留作歧义。";
    let prompt=format!("{}\n\n请统合以上内容，只返回 JSON：{{\"overview\":string,\"endingState\":string,\"unresolved\":[{{\"title\":string,\"detail\":string}}],\"constraints\":[string],\"choices\":[string],\"ambiguities\":[string]}}\noverview 为全书概要；endingState 为当前结局状态；unresolved 为未决线索；constraints 为续写约束；choices 为开放选择；ambiguities 为实质歧义。本任务不产出原文出处，结果标记为推断，需经作者确认后才作数。",ctx.text);
    let (output, usage) =
        model::request_tracked(db, run_id, profile, system, &prompt, 4096, "book-synthesis")?;
    if one(
        db,
        "SELECT status FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?["status"]
        == "canceled"
    {
        return Err("任务已取消。".into());
    }
    let overview = output["overview"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("模型未生成全书概要。")?;
    let ending = output["endingState"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("模型未生成结局状态。")?;
    let list = |field: &str| -> Vec<String> {
        output[field]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| row.as_str().map(|s| format!("- {s}")))
            .take(40)
            .collect()
    };
    let unresolved = output["unresolved"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            Some(format!(
                "- {}：{}",
                row["title"].as_str()?,
                row["detail"].as_str()?
            ))
        })
        .take(40)
        .collect::<Vec<_>>();
    let candidates = [
        ("synthesis:overview", "全书概要", overview.to_string()),
        ("synthesis:ending-state", "结局状态", ending.to_string()),
        ("synthesis:unresolved", "未决线索", unresolved.join("\n")),
        (
            "synthesis:constraints",
            "续写约束",
            list("constraints").join("\n"),
        ),
        ("synthesis:choices", "开放选择", list("choices").join("\n")),
        (
            "synthesis:ambiguities",
            "实质歧义",
            list("ambiguities").join("\n"),
        ),
    ];
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let mut count = 0;
    for (key, title, content) in candidates {
        if content.trim().is_empty() {
            continue;
        }
        let existing=query(&tx,"SELECT id,isUserEdited FROM MemoryEntry WHERE projectId=? AND category='summary' AND key=? AND isCurrent=1 ORDER BY updatedAt DESC LIMIT 1",
            &[json!(project_id),json!(key)])?.into_iter().next();
        let target = existing
            .as_ref()
            .map(|row| row["id"].clone())
            .unwrap_or(Value::Null);
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
        execute(&tx,"INSERT INTO MemoryProposal(id,projectId,runId,kind,category,key,title,content,status,citationsJson,targetEntryId,reason,state,createdAt,updatedAt) VALUES(?,?,?,?,'summary',?,?,?,'inferred','[]',?,?,'pending',?,?)",
            &[json!(id()),json!(project_id),json!(run_id),json!(kind),json!(key),json!(title),json!(content),
                target,json!(if kind=="conflict"{Some("目标条目已人工修改，需人工裁决。")}else{None}),json!(now()),json!(now())])?;
        count += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((count, usage))
}

fn run_direction(
    db: &mut Connection,
    profile: &model::Profile,
    run_id: &str,
    project_id: &str,
) -> Result<(usize, Value)> {
    let ctx = context::build(db, project_id, 2)?;
    if ctx.memory_count == 0 {
        return Err("还没有记忆条目可供参考。".into());
    }
    let system="你是一名小说策划，负责在既有故事之上提出可选续写方向。每个方向必须扎根于记忆与最近原文，不得凭空引入新设定。方向之间应有显著差异；只提出方向，不写正文或章纲，不替作者拍板。";
    let prompt=format!("{}\n\n请提出 3 个差异明显的续写方向，只返回 JSON：{{\"candidates\":[{{\"direction\":string,\"summary\":string,\"relatedThreads\":[string]}}]}}。direction 用一句话命名；summary 说明核心冲突、人物选择与既有悬念关系；relatedThreads 使用已有记忆中的线索标题。",ctx.text);
    let (output, usage) =
        model::request_tracked(db, run_id, profile, system, &prompt, 8192, "direction")?;
    if one(
        db,
        "SELECT status FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?["status"]
        == "canceled"
    {
        return Err("任务已取消。".into());
    }
    let candidates = output["candidates"]
        .as_array()
        .filter(|rows| !rows.is_empty() && rows.len() <= 4)
        .ok_or("模型未生成有效候选方向。")?;
    let mut clean = Vec::new();
    for item in candidates {
        let direction = item["direction"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 300)
            .ok_or("候选方向名称无效。")?;
        let summary = item["summary"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 1500)
            .ok_or("候选方向说明无效。")?;
        let related = item["relatedThreads"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 120)
            .take(20)
            .collect::<Vec<_>>();
        clean.push((
            direction.to_string(),
            summary.to_string(),
            json!(related).to_string(),
        ));
    }
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for (direction, summary, related) in &clean {
        execute(&tx,"INSERT INTO ContinuationPlan(id,projectId,direction,summary,outlineJson,relatedThreadsJson,status,version,createdAt,updatedAt) VALUES(?,?,?,?,'[]',?,'draft',1,?,?)",
            &[json!(id()),json!(project_id),json!(direction),json!(summary),json!(related),json!(now()),json!(now())])?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((clean.len(), usage))
}

fn run_outline(
    db: &mut Connection,
    profile: &model::Profile,
    run_id: &str,
    project_id: &str,
    payload: &Value,
) -> Result<(usize, Value)> {
    let plan_id = resolve_plan_id(db, project_id, payload)?;
    let plan = one(
        db,
        "SELECT * FROM ContinuationPlan WHERE id=? AND projectId=?",
        &[json!(plan_id), json!(project_id)],
    )?;
    if !query(
        db,
        "SELECT id FROM DraftChapter WHERE planId=? LIMIT 1",
        &[json!(plan_id)],
    )?
    .is_empty()
    {
        return Err("这个方向已有草稿，不能直接重生成章纲。".into());
    }
    let first_number = crate::chapter_titles::plan_first(db, &plan_id)?;
    crate::chapter_titles::save_plan(db, &plan_id, first_number)?;
    let automatic = payload["outlineMode"] == "auto";
    if !automatic
        && payload
            .get("outlineCount")
            .is_some_and(|value| !value.is_null() && value.as_u64().is_none())
    {
        return Err("章纲目标数量应为整数。".into());
    }
    let count = payload["outlineCount"].as_u64().unwrap_or(5);
    if !(1..=30).contains(&count) {
        return Err("章纲目标数量无效。".into());
    }
    let focus = format!(
        "{}\n{}\n{}",
        plan["direction"], plan["summary"], plan["relatedThreadsJson"]
    );
    let ctx = context::build_for(db, project_id, 2, &focus)?;
    let direction = plan["direction"].as_str().unwrap_or("");
    let summary = plan["summary"].as_str().unwrap_or("");
    let system="你是一名小说结构师，负责为已选定方向排出接下来若干章的章纲。严格服务于方向，每章推进核心冲突；不得推翻既有事实。只排章纲，不写正文。title 只填写纯章名，不要包含“第几章”、序号或 Markdown 标记。若作者要求与既有事实存在明确冲突，返回 conflicts 并令 chapters 为空。";
    let length_instruction = if automatic {
        "请根据方向、故事记忆和本段剧情目标智能安排章数，通常 3–8 章，最多 30 章；以自然完成本段剧情为准，不凑章数，并在 notes 中说明篇幅安排理由".to_string()
    } else {
        format!("请为这个方向排出接下来 {count} 章的章纲")
    };
    let prompt=format!("{}\n\n【已选定的续写方向】\n{}\n【方向说明与作者要求】\n{}\n方向说明中的剧情目标、人物选择、节奏和禁用情节均需遵循；未来构思不能当作已经发生的故事事实。\n\n{}，只返回 JSON：{{\"chapters\":[{{\"title\":string,\"summary\":string,\"beats\":[string],\"relatedThreads\":[string]}}],\"notes\":string,\"conflicts\":[string]}}。如有与既有事实明确冲突，请在 conflicts 逐条指出，并令 chapters 为空。",ctx.text,direction,summary,length_instruction);
    let (output, usage) =
        model::request_tracked(db, run_id, profile, system, &prompt, 8192, "outline")?;
    if one(
        db,
        "SELECT status FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?["status"]
        == "canceled"
    {
        return Err("任务已取消。".into());
    }
    let conflicts = output["conflicts"].as_array().cloned().unwrap_or_default();
    if !conflicts.is_empty() {
        return Err(format!(
            "方向与已有故事事实可能冲突，尚未写入章纲：\n{}",
            conflicts
                .iter()
                .filter_map(Value::as_str)
                .map(|s| format!("• {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    let chapters = output["chapters"]
        .as_array()
        .filter(|rows| !rows.is_empty() && rows.len() <= 30)
        .ok_or("未生成有效章纲，请重试。")?;
    let mut clean = Vec::new();
    for (i, item) in chapters.iter().enumerate() {
        let title = item["title"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 120)
            .ok_or("章纲标题无效。")?;
        let summary = item["summary"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 1200)
            .ok_or("章纲内容无效。")?;
        let strings = |field: &str| max_strings(item, field, 20);
        clean.push(json!({"index":i+1,"title":title,"summary":summary,
            "beats":strings("beats"),"relatedThreads":strings("relatedThreads")}));
    }
    crate::continuation::update_plan(
        db,
        project_id,
        &plan_id,
        &json!({"outline":clean,"expectedVersion":plan["version"]}),
    )?;
    Ok((clean.len(), usage))
}

fn max_strings(item: &Value, field: &str, limit: usize) -> Vec<String> {
    item[field]
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

fn run_draft(
    db: &mut Connection,
    profile: &model::Profile,
    run_id: &str,
    project_id: &str,
    unit_id: &str,
    payload: &Value,
) -> Result<(usize, Value)> {
    let index = unit_id
        .strip_prefix("draft-")
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .ok_or("草稿任务编号无效。")?;
    let plan_id = resolve_plan_id(db, project_id, payload)?;
    let plan = one(
        db,
        "SELECT * FROM ContinuationPlan WHERE id=? AND projectId=?",
        &[json!(plan_id), json!(project_id)],
    )?;
    let outline: Value =
        serde_json::from_str(plan["outlineJson"].as_str().unwrap_or("[]")).unwrap_or(json!([]));
    let item = outline
        .as_array()
        .and_then(|items| items.iter().find(|item| item["index"] == index))
        .ok_or("章纲里没有这章。")?
        .clone();
    let before=query(db,"SELECT id,version FROM DraftChapter WHERE projectId=? AND planId=? AND \"index\"=? LIMIT 1",
        &[json!(project_id),json!(plan_id),json!(index)])?.into_iter().next();
    let focus = format!("{}\n{}\n{}", plan["direction"], plan["summary"], item);
    let ctx = context::build_for(db, project_id, 3, &focus)?;
    let history = context::draft_history(db, project_id, &plan_id, index, false, &focus)?;
    let beats = max_strings(&item, "beats", 20)
        .into_iter()
        .map(|s| format!("- {s}"))
        .collect::<Vec<_>>()
        .join("\n");
    let related = max_strings(&item, "relatedThreads", 20).join("、");
    let previous_text = format!(
        "【本方向此前正文（按章序节选，未发生的章纲不是事实）】\n{}",
        history.text
    );
    let system="你是一名小说续写者，负责按既定章纲写出这一章的正文。严格承接已确认的故事事实，与前情保持连贯；只写本章，不提前写后章，不写总结或作者按；title 只填写纯章名，不含章号；content 不要重复章节标题或章号；遵循方向说明中的目标、节奏和禁用情节。";
    let prompt=format!("{}\n\n【已选定的续写方向】\n{}\n【方向说明与作者要求】\n{}\n【本章章纲（第 {} 章）】\n标题：{}\n走向：{}\n关键节拍：\n{}\n承接线索：{}\n{}\n请写出本章正文，只返回 JSON：{{\"title\":string,\"content\":string}}。content 为 1800–3500 字（不含空白）的自然段正文，不含元信息或 Markdown 标记。",
        ctx.text,plan["direction"].as_str().unwrap_or(""),plan["summary"].as_str().unwrap_or(""),
        crate::chapter_titles::plan_first(db, &plan_id)? + index - 1,crate::chapter_titles::display_title(&item["title"]),item["summary"].as_str().unwrap_or(""),beats,related,previous_text);
    let (output, usage) =
        model::request_tracked(db, run_id, profile, system, &prompt, 8000, "draft")?;
    if one(
        db,
        "SELECT status FROM AnalysisRun WHERE id=?",
        &[json!(run_id)],
    )?["status"]
        == "canceled"
    {
        return Err("任务已取消。".into());
    }
    let title = output["title"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 120)
        .ok_or("模型草稿标题无效。")?;
    let title = crate::chapter_titles::display_title(&json!(title));
    let content = output["content"]
        .as_str()
        .map(str::trim)
        .filter(|s| s.encode_utf16().count() >= 50 && s.encode_utf16().count() <= 200000)
        .ok_or("模型草稿正文过短或过长。")?;
    crate::model_schema::validate_draft(content)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let current=query(&tx,"SELECT id,version FROM DraftChapter WHERE projectId=? AND planId=? AND \"index\"=? LIMIT 1",
        &[json!(project_id),json!(plan_id),json!(index)])?.into_iter().next();
    if current.as_ref().map(|row| (&row["id"], &row["version"]))
        != before.as_ref().map(|row| (&row["id"], &row["version"]))
    {
        return Err("草稿已被其他操作修改，请重新生成。".into());
    }
    let latest = context::draft_history(&tx, project_id, &plan_id, index, false, &focus)?;
    if latest.drafts != history.drafts {
        return Err("前文已修改，请重新生成。".into());
    }
    crate::continuation::invalidate_checks(&tx, project_id, &plan_id)?;
    let draft_id = if let Some(current) = current {
        let draft_id = current["id"].as_str().ok_or("草稿编号无效。")?.to_string();
        execute(&tx,"UPDATE DraftChapter SET title=?,content=?,outlineItemJson=?,version=version+1,memoryUpdateStatus='none',continuityCheckJson='{}',updatedAt=? WHERE id=?",
            &[json!(title),json!(content),json!(item.to_string()),json!(now()),json!(draft_id)])?;
        draft_id
    } else {
        let draft_id = id();
        execute(&tx,"INSERT INTO DraftChapter(id,projectId,planId,\"index\",title,content,outlineItemJson,version,continuityCheckJson,memoryUpdateStatus,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,'{}','none',?,?)",
            &[json!(draft_id),json!(project_id),json!(plan_id),json!(index),json!(title),json!(content),
                json!(item.to_string()),json!(now()),json!(now())])?;
        draft_id
    };
    execute(
        &tx,
        "DELETE FROM MemoryProposal WHERE draftId=? AND state='pending'",
        &[json!(draft_id)],
    )?;
    execute(
        &tx,
        "DELETE FROM ContinuityIssue WHERE draftId=?",
        &[json!(draft_id)],
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok((1, usage))
}
