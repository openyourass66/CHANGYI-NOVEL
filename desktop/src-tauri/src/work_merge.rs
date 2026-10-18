use crate::database::{self, execute, id, now, one, query, Result};
use rusqlite::{Connection, TransactionBehavior};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path};

pub(crate) fn merge(db: &mut Connection, root: &Path, work_id: &str) -> Result<Value> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let work = one(
        &tx,
        "SELECT * FROM NativeWork WHERE id=? AND deletedAt IS NULL",
        &[json!(work_id)],
    )?;
    if let Some(previous) = query(
        &tx,
        "SELECT * FROM NativeWorkMerge WHERE workId=?",
        &[json!(work_id)],
    )?
    .first()
    {
        return Ok(json!({"merge":previous,"alreadyMerged":true}));
    }
    let project_id = work["sourceProjectId"]
        .as_str()
        .ok_or("原作已删除，无法并入。")?;
    let project = one(
        &tx,
        "SELECT * FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    if crate::automation::active(&tx, project_id)? || !query(&tx,"SELECT id FROM AnalysisRun WHERE projectId=? AND status IN ('pending','running') LIMIT 1", &[json!(project_id)])?.is_empty() {
        return Err("原作仍有任务运行中，请完成或停止任务后再并入。".into());
    }
    let chapters = query(
        &tx,
        "SELECT * FROM NativeWorkChapter WHERE workId=? ORDER BY \"index\"",
        &[json!(work_id)],
    )?;
    if chapters.is_empty() {
        return Err("作品没有可并入的正文。".into());
    }
    let original = query(
        &tx,
        "SELECT * FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?;
    let mut text = String::new();
    let mut offset = 0i64;
    for chapter in &original {
        let part = format!(
            "{}\n{}\n\n",
            crate::chapter_titles::original_title(chapter),
            chapter["content"].as_str().unwrap_or("")
        );
        offset += part.encode_utf16().count() as i64;
        text.push_str(&part);
    }
    let first_number = original
        .iter()
        .filter_map(|chapter| chapter["normalizedIndex"].as_i64())
        .max()
        .unwrap_or(0);
    let first_order = original
        .iter()
        .filter_map(|chapter| chapter["sortOrder"].as_i64())
        .max()
        .unwrap_or(0);
    crate::chapter_titles::save_work(&tx, work_id, first_number + 1)?;
    let mut appended = Vec::new();
    for (index, chapter) in chapters.iter().enumerate() {
        let number = first_number + index as i64 + 1;
        let title = format!(
            "第{number}章 {}",
            crate::chapter_titles::display_title(&chapter["title"])
        );
        let heading = format!("{title}\n");
        text.push_str(&heading);
        offset += heading.encode_utf16().count() as i64;
        let start = offset;
        let content = chapter["content"].as_str().ok_or("作品正文无效。")?;
        if content.trim().is_empty() {
            return Err("作品含空白章节，无法并入。".into());
        }
        text.push_str(content);
        offset += content.encode_utf16().count() as i64;
        appended.push((
            id(),
            chapter["index"].as_i64().unwrap_or(index as i64 + 1),
            number,
            first_order + index as i64 + 1,
            title,
            start,
            offset,
            content,
        ));
        text.push_str("\n\n");
        offset += 2;
    }
    if text.len() > 200 * 1024 * 1024 {
        return Err("合并后的正文超过 200MB，请拆分后再操作。".into());
    }
    let source_id = id();
    let stored = format!("projects/{project_id}/sources/merged-{source_id}.txt");
    let absolute = database::safe_path(root, &stored)?;
    fs::create_dir_all(absolute.parent().ok_or("原作目录无效。")?).map_err(|e| e.to_string())?;
    if let Err(error) = fs::write(&absolute, text.as_bytes()) {
        let _ = fs::remove_file(&absolute);
        return Err(error.to_string());
    }
    let outcome = (|| -> Result<Value> {
        let at = now();
        execute(&tx,"INSERT INTO SourceDocument(id,projectId,fileName,format,storedPath,contentHash,encoding,byteSize,importedAt) VALUES(?,?,?,'txt',?,?,'UTF-8',?,?)", &[json!(source_id),json!(project_id),json!(format!("{}（已并入续写）.txt",project["name"].as_str().unwrap_or("原作"))),json!(stored),json!(format!("{:x}",Sha256::digest(text.as_bytes()))),json!(text.len()),json!(at)])?;
        let mut mapped = HashMap::new();
        for (chapter_id, work_index, number, order, title, start, end, content) in &appended {
            execute(&tx,"INSERT INTO Chapter(id,projectId,sourceDocumentId,rawTitle,normalizedIndex,content,startOffset,endOffset,sortOrder,splitMethod,parseConfidence,flagsJson,analysisStatus,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,'manual',1,'[]','pending',?,?)", &[json!(chapter_id),json!(project_id),json!(source_id),json!(title),json!(number),json!(content),json!(start),json!(end),json!(order),json!(at),json!(at)])?;
            mapped.insert(*work_index, chapter_id.as_str());
        }
        let (added, conflicts, skipped) = merge_memories(&tx, work_id, project_id, &mapped, at)?;
        execute(&tx,"INSERT INTO NativeWorkMerge(workId,projectId,mergedAt,chapterCount,memoryAdded,memoryConflicts,memorySkipped) VALUES(?,?,?,?,?,?,?)", &[json!(work_id),json!(project_id),json!(at),json!(chapters.len()),json!(added),json!(conflicts),json!(skipped)])?;
        execute(
            &tx,
            "UPDATE NovelProject SET updatedAt=? WHERE id=?",
            &[json!(at), json!(project_id)],
        )?;
        Ok(
            json!({"merge":one(&tx,"SELECT * FROM NativeWorkMerge WHERE workId=?", &[json!(work_id)])?,"alreadyMerged":false}),
        )
    })();
    match outcome {
        Ok(result) => match tx.commit() {
            Ok(()) => Ok(result),
            Err(error) => {
                let _ = fs::remove_file(&absolute);
                Err(error.to_string())
            }
        },
        Err(error) => {
            let _ = fs::remove_file(&absolute);
            Err(error)
        }
    }
}

fn merge_memories(
    db: &Connection,
    work_id: &str,
    project_id: &str,
    chapters: &HashMap<i64, &str>,
    at: i64,
) -> Result<(usize, usize, usize)> {
    let mut added = 0;
    let mut conflicts = 0;
    let mut skipped = 0;
    for snapshot in query(
        db,
        "SELECT * FROM NativeWorkMemory WHERE workId=? ORDER BY chapterIndex,id",
        &[json!(work_id)],
    )? {
        let memory: Value =
            serde_json::from_str(snapshot["payloadJson"].as_str().ok_or("作品记忆无效。")?)
                .map_err(|_| "作品记忆损坏。")?;
        let source = query(
            db,
            "SELECT * FROM MemoryProposal WHERE id=? AND projectId=?",
            &[snapshot["sourceProposalId"].clone(), json!(project_id)],
        )?
        .into_iter()
        .next();
        let state = source
            .as_ref()
            .map(|row| &row["state"])
            .unwrap_or(&memory["state"]);
        if state == "accepted" || state == "rejected" {
            skipped += 1;
            continue;
        }
        if !query(db,"SELECT id FROM MemoryEntry WHERE projectId=? AND isCurrent=1 AND category=? AND key IS ? AND title IS ? AND content=? AND status=? LIMIT 1", &[json!(project_id),memory["category"].clone(),memory["key"].clone(),memory["title"].clone(),memory["content"].clone(),memory["status"].clone()])?.is_empty() {
            if let Some(source) = source.as_ref().filter(|source| source["content"] == memory["content"]) {
                execute(db,"UPDATE MemoryProposal SET state='accepted',updatedAt=? WHERE id=?", &[json!(at),source["id"].clone()])?;
                crate::proposals::reconcile_draft(db, source["draftId"].as_str())?;
            }
            skipped += 1; continue;
        }
        let chapter = chapters
            .get(
                &snapshot["chapterIndex"]
                    .as_i64()
                    .ok_or("记忆来源章节无效。")?,
            )
            .ok_or("记忆来源章节不存在。")?;
        let target = if memory["targetEntryId"].is_string()
            && !query(
                db,
                "SELECT id FROM MemoryEntry WHERE id=? AND projectId=?",
                &[memory["targetEntryId"].clone(), json!(project_id)],
            )?
            .is_empty()
        {
            memory["targetEntryId"].clone()
        } else if memory["key"].is_string() {
            query(db,"SELECT id FROM MemoryEntry WHERE projectId=? AND category=? AND key=? AND isCurrent=1 ORDER BY updatedAt DESC LIMIT 1", &[json!(project_id),memory["category"].clone(),memory["key"].clone()])?.first().map(|row| row["id"].clone()).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        let reusable = source.as_ref().filter(|source| {
            ["category", "key", "title", "content", "status"]
                .iter()
                .all(|field| source[*field] == memory[*field])
        });
        let proposal_id = reusable
            .and_then(|row| row["id"].as_str())
            .map(str::to_string)
            .unwrap_or_else(id);
        let citations = json!([{"chapterId":chapter,"startOffset":0,"endOffset":0,"excerpt":""}]);
        if reusable.is_some() {
            execute(db,"UPDATE MemoryProposal SET citationsJson=?,targetEntryId=?,state='pending',updatedAt=? WHERE id=?", &[json!(citations.to_string()),target,json!(at),json!(proposal_id)])?;
        } else {
            execute(db,"INSERT INTO MemoryProposal(id,projectId,chapterId,kind,category,key,title,content,status,citationsJson,targetEntryId,state,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)", &[json!(proposal_id),json!(project_id),json!(chapter),json!(if target.is_null(){"add"}else{"update"}),memory["category"].clone(),memory["key"].clone(),memory["title"].clone(),memory["content"].clone(),memory["status"].clone(),json!(citations.to_string()),target,json!(at),json!(at)])?;
        }
        let result = crate::proposals::accept_in_transaction(db, &proposal_id)?;
        if result["proposal"]["state"] == "accepted" {
            added += 1;
        } else {
            conflicts += 1;
        }
        if let Some(source) = source
            .filter(|source| source["id"] != proposal_id && source["content"] == memory["content"])
        {
            execute(
                db,
                "UPDATE MemoryProposal SET state=?,reason=?,updatedAt=? WHERE id=?",
                &[
                    result["proposal"]["state"].clone(),
                    result["proposal"]["reason"].clone(),
                    json!(at),
                    source["id"].clone(),
                ],
            )?;
            crate::proposals::reconcile_draft(db, source["draftId"].as_str())?;
        }
    }
    Ok((added, conflicts, skipped))
}
