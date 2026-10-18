use crate::database::{execute, one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

fn digit(c: char) -> Option<i64> {
    "零一二三四五六七八九"
        .chars()
        .position(|d| d == c)
        .map(|n| n as i64)
        .or_else(|| match c {
            '〇' => Some(0),
            '两' => Some(2),
            '０'..='９' => Some(c as i64 - '０' as i64),
            _ => c.to_digit(10).map(i64::from),
        })
}

fn number(text: &str) -> Option<i64> {
    let mut total = 0i64;
    let mut section = 0i64;
    let mut current = 0i64;
    for c in text.chars().filter(|c| !c.is_whitespace()) {
        if let Some(n) = digit(c) {
            current = current.checked_mul(10)?.checked_add(n)?;
        } else {
            let unit = match c {
                '十' => 10,
                '百' => 100,
                '千' => 1000,
                '万' => 10000,
                _ => return None,
            };
            if unit == 10000 {
                total = total.checked_add(section.checked_add(current)?.max(1).checked_mul(unit)?)?;
                section = 0;
            } else {
                section = section.checked_add(current.max(1).checked_mul(unit)?)?;
            }
            current = 0;
        }
    }
    total.checked_add(section)?.checked_add(current)
}

pub(crate) fn prefix(title: &str) -> Option<(i64, &str)> {
    let text = title.trim().strip_prefix('第')?;
    let end = text.find(['章', '回'])?;
    let raw = text[..end].trim();
    if raw.is_empty() {
        return None;
    }
    let n = number(raw)?;
    let rest = text[end..].chars().next()?.len_utf8() + end;
    Some((
        n,
        text[rest..].trim_start_matches(|c: char| c.is_whitespace() || "·•:：、.-—".contains(c)),
    ))
}

pub(crate) fn clean(title: &str) -> String {
    let mut title = title.trim();
    while let Some((_, rest)) = prefix(title) {
        title = rest.trim();
    }
    title.to_string()
}

pub(crate) fn display_title(title: &Value) -> String {
    let title = clean(title.as_str().unwrap_or(""));
    if title.is_empty() {
        "无标题".into()
    } else {
        title
    }
}

// Old merged chapters keep their source offsets and text. Correct the heading in views only.
pub(crate) fn original_title(chapter: &Value) -> String {
    let raw = chapter["rawTitle"].as_str().unwrap_or("");
    if chapter["splitMethod"] == "manual"
        && chapter["flagsJson"] == "[]"
        && prefix(raw).and_then(|(_, rest)| prefix(rest)).is_some()
    {
        return format!(
            "第{}章 {}",
            chapter["normalizedIndex"].as_i64().unwrap_or(1),
            display_title(&json!(raw))
        );
    }
    raw.to_string()
}

pub(crate) fn next_number(db: &Connection, project: &str) -> Result<i64> {
    Ok(one(
        db,
        "SELECT COALESCE(MAX(normalizedIndex),0)+1 AS n FROM Chapter WHERE projectId=?",
        &[json!(project)],
    )?["n"]
        .as_i64()
        .unwrap_or(1)
        .max(1))
}

pub(crate) fn save_plan(db: &Connection, plan: &str, first: i64) -> Result<()> {
    execute(
        db,
        "INSERT OR IGNORE INTO NativePlanNumbering(planId,firstNumber) VALUES(?,?)",
        &[json!(plan), json!(first)],
    )?;
    Ok(())
}

pub(crate) fn draft_number(db: &Connection, draft: &Value) -> Result<i64> {
    let first = if let Some(plan) = draft["planId"].as_str() {
        plan_first(db, plan)?
    } else {
        1
    };
    Ok(first + draft["index"].as_i64().unwrap_or(1) - 1)
}

pub(crate) fn plan_first(db: &Connection, plan: &str) -> Result<i64> {
    if let Some(row) = query(
        db,
        "SELECT firstNumber FROM NativePlanNumbering WHERE planId=?",
        &[json!(plan)],
    )?
    .first()
    {
        return Ok(row["firstNumber"].as_i64().unwrap_or(1));
    }
    let row = one(
        db,
        "SELECT projectId,outlineJson FROM ContinuationPlan WHERE id=?",
        &[json!(plan)],
    )?;
    let outline: Value =
        serde_json::from_str(row["outlineJson"].as_str().unwrap_or("[]")).unwrap_or(json!([]));
    let drafts = query(
        db,
        "SELECT \"index\",title FROM DraftChapter WHERE planId=? ORDER BY \"index\" LIMIT 1",
        &[json!(plan)],
    )?;
    let archived = query(db, "SELECT w.id,n.firstNumber FROM NativeWork w JOIN NativeWorkflow f ON f.id=w.workflowId LEFT JOIN NativeWorkNumbering n ON n.workId=w.id WHERE json_extract(f.configJson,'$.planId')=? AND w.deletedAt IS NULL ORDER BY w.generatedAt LIMIT 1", &[json!(plan)])?;
    let archived_first = if let Some(work) = archived.first() {
        if let Some(n) = work["firstNumber"].as_i64() {
            Some(n)
        } else {
            merged_first(db, work["id"].as_str().unwrap_or(""))?
        }
    } else {
        None
    };
    let first = archived_first
        .or_else(|| {
            outline
                .as_array()
                .and_then(|rows| rows.first())
                .into_iter()
                .chain(drafts.first())
                .find_map(|item| {
                    prefix(item["title"].as_str()?)
                        .map(|(n, _)| n - item["index"].as_i64().unwrap_or(1) + 1)
                })
                .filter(|n| *n > 0)
        })
        .unwrap_or(next_number(db, row["projectId"].as_str().unwrap_or(""))?);
    if outline.as_array().is_some_and(|rows| !rows.is_empty()) || !drafts.is_empty() {
        save_plan(db, plan, first)?;
    }
    Ok(first)
}

pub(crate) fn save_work(db: &Connection, work: &str, first: i64) -> Result<()> {
    execute(db, "INSERT INTO NativeWorkNumbering(workId,firstNumber) VALUES(?,?) ON CONFLICT(workId) DO UPDATE SET firstNumber=excluded.firstNumber", &[json!(work),json!(first)])?;
    Ok(())
}

pub(crate) fn work_first(db: &Connection, work: &str) -> Result<i64> {
    if let Some(row) = query(
        db,
        "SELECT firstNumber FROM NativeWorkNumbering WHERE workId=?",
        &[json!(work)],
    )?
    .first()
    {
        return Ok(row["firstNumber"].as_i64().unwrap_or(1));
    }
    let row = one(db, "SELECT * FROM NativeWork WHERE id=?", &[json!(work)])?;
    let chapters = query(
        db,
        "SELECT \"index\",title FROM NativeWorkChapter WHERE workId=? ORDER BY \"index\" LIMIT 1",
        &[json!(work)],
    )?;
    let explicit = chapters
        .first()
        .and_then(|c| {
            prefix(c["title"].as_str()?).map(|(n, _)| n - c["index"].as_i64().unwrap_or(1) + 1)
        })
        .filter(|n| *n > 0);
    let merged = merged_first(db, work)?;
    let plan = query(db, "SELECT p.id FROM NativeWorkflow f JOIN ContinuationPlan p ON p.id=json_extract(f.configJson,'$.planId') WHERE f.id=?", &[row["workflowId"].clone()])?;
    let first = if let Some(n) = merged {
        n
    } else if let Some(n) = explicit {
        n
    } else if let Some(plan) = plan.first() {
        plan_first(db, plan["id"].as_str().unwrap_or(""))?
    } else {
        next_number(db, row["sourceProjectId"].as_str().unwrap_or(""))?
    };
    save_work(db, work, first)?;
    Ok(first)
}

fn merged_first(db: &Connection, work: &str) -> Result<Option<i64>> {
    Ok(query(db, "SELECT c.normalizedIndex-w.\"index\"+1 AS n FROM NativeWorkChapter w JOIN NativeWorkMerge m ON m.workId=w.workId JOIN Chapter c ON c.projectId=m.projectId AND c.content=w.content JOIN SourceDocument s ON s.id=c.sourceDocumentId WHERE w.workId=? AND s.storedPath LIKE '%/merged-%' ORDER BY w.\"index\",c.sortOrder LIMIT 1", &[json!(work)])?.first().and_then(|row| row["n"].as_i64()).filter(|n| *n > 0))
}

pub(crate) fn backfill(db: &Connection) -> Result<()> {
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    for row in query(&tx, "SELECT id FROM ContinuationPlan WHERE outlineJson!='[]' OR EXISTS (SELECT 1 FROM DraftChapter d WHERE d.planId=ContinuationPlan.id)", &[])? { plan_first(&tx, row["id"].as_str().unwrap_or(""))?; }
    for row in query(
        &tx,
        "SELECT id FROM NativeWork WHERE deletedAt IS NULL",
        &[],
    )? {
        work_first(&tx, row["id"].as_str().unwrap_or(""))?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_only_leading_chapter_labels() {
        for (raw, expected) in [
            ("第6章 第六章门外", "门外"),
            ("第 七 章 · 观规", "观规"),
            ("第108章：第 一百零八 章 山下的漆盒", "山下的漆盒"),
            ("门外的第六章", "门外的第六章"),
            ("第六感", "第六感"),
            ("三十年后", "三十年后"),
            ("第六章", ""),
        ] {
            assert_eq!(clean(raw), expected);
        }
        assert_eq!(prefix("第一千零二十章 门外").unwrap().0, 1020);
    }
}
