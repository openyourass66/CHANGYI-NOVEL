use crate::database::Result;
use serde_json::Value;

fn text(row: &Value, name: &str, min: usize, max: usize, required: bool) -> Result<()> {
    if !required && row.get(name).is_none() {
        return Ok(());
    }
    let value = row[name]
        .as_str()
        .ok_or_else(|| format!("{name} 必须是字符串"))?
        .trim();
    if !(min..=max).contains(&value.encode_utf16().count()) {
        return Err(format!("{name} 长度须为 {min}–{max}"));
    }
    Ok(())
}
fn rows<'a>(
    row: &'a Value,
    name: &str,
    min: usize,
    max: usize,
    required: bool,
) -> Result<&'a [Value]> {
    if !required && row.get(name).is_none() {
        return Ok(&[]);
    }
    let values = row[name]
        .as_array()
        .ok_or_else(|| format!("{name} 必须是数组"))?;
    if !(min..=max).contains(&values.len()) {
        return Err(format!("{name} 数量须为 {min}–{max}"));
    }
    Ok(values)
}
fn strings(row: &Value, name: &str, max: usize, len: usize) -> Result<()> {
    for value in rows(row, name, 0, max, false)? {
        let value = value
            .as_str()
            .ok_or_else(|| format!("{name} 条目必须是字符串"))?
            .trim();
        if value.is_empty() || value.encode_utf16().count() > len {
            return Err(format!("{name} 条目长度无效"));
        }
    }
    Ok(())
}
fn choice(row: &Value, name: &str, values: &[&str], required: bool) -> Result<()> {
    if !required && row.get(name).is_none() {
        return Ok(());
    }
    if !row[name]
        .as_str()
        .is_some_and(|value| values.contains(&value))
    {
        return Err(format!("{name} 取值无效"));
    }
    Ok(())
}
pub const DRAFT_MIN_CHARS: usize = 1800;
pub const DRAFT_MAX_CHARS: usize = 3500;

pub fn validate_draft(content: &str) -> Result<()> {
    let count = content.chars().filter(|ch| !ch.is_whitespace()).count();
    if !(DRAFT_MIN_CHARS..=DRAFT_MAX_CHARS).contains(&count) {
        return Err(format!("正文为 {count} 字，须为 {DRAFT_MIN_CHARS}–{DRAFT_MAX_CHARS} 字（不含空白）；请重新输出完整正文"));
    }
    Ok(())
}

pub fn validate(task: &str, value: &Value) -> Result<()> {
    if !value.is_object() {
        return Err("输出必须是 JSON 对象".into());
    }
    match task {
        "chapter-extract" => {
            let note = &value["chapterNote"];
            text(note, "summary", 1, 2000, true)?;
            text(note, "excerpt", 1, 300, true)?;
            for row in rows(value, "events", 0, 40, false)? {
                text(row, "description", 1, 600, true)?;
                text(row, "excerpt", 1, 300, true)?;
            }
            for row in rows(value, "characters", 0, 40, false)? {
                text(row, "name", 1, 80, true)?;
                text(row, "state", 0, 600, false)?;
                text(row, "excerpt", 1, 300, true)?;
                for item in rows(row, "knowledge", 0, 20, false)? {
                    text(item, "infoItem", 1, 300, true)?;
                    text(item, "excerpt", 1, 300, true)?;
                    choice(item, "relation", &["known", "misbelieved", "unknown"], true)?;
                }
            }
            for (field, name, detail) in [
                ("settings", "name", "detail"),
                ("threads", "title", "detail"),
                ("glossary", "term", "definition"),
            ] {
                for row in rows(value, field, 0, 40, false)? {
                    text(row, name, 1, 120, true)?;
                    text(row, detail, 1, 1200, true)?;
                    text(row, "excerpt", 1, 300, true)?;
                    if field == "threads" {
                        choice(
                            row,
                            "state",
                            &["open", "advanced", "resolved", "uncertain"],
                            false,
                        )?;
                    }
                }
            }
        }
        "book-synthesis" => {
            text(value, "overview", 1, 2000, true)?;
            text(value, "endingState", 1, 2000, true)?;
            for row in rows(value, "unresolved", 0, 40, false)? {
                text(row, "title", 1, 120, true)?;
                text(row, "detail", 1, 1200, true)?;
            }
            for name in ["constraints", "choices", "ambiguities"] {
                strings(value, name, 40, 600)?;
            }
        }
        "direction" => {
            for row in rows(value, "candidates", 1, 4, true)? {
                text(row, "direction", 1, 300, true)?;
                text(row, "summary", 1, 1500, true)?;
                strings(row, "relatedThreads", 20, 120)?;
            }
        }
        "outline" => {
            for row in rows(value, "chapters", 0, 30, true)? {
                text(row, "title", 1, 120, true)?;
                text(row, "summary", 1, 1200, true)?;
                strings(row, "beats", 20, 300)?;
                strings(row, "relatedThreads", 20, 120)?;
            }
            text(value, "notes", 0, 1000, false)?;
            strings(value, "conflicts", 10, 1000)?;
        }
        "draft" => {
            text(value, "title", 1, 120, true)?;
            text(value, "content", 1, 200000, true)?;
            validate_draft(value["content"].as_str().unwrap_or(""))?;
        }
        "continuity-check" => {
            for row in rows(value, "issues", 0, 12, true)? {
                choice(
                    row,
                    "category",
                    &["时间", "因果", "设定", "人物认知", "视角", "顺序", "其他"],
                    true,
                )?;
                choice(row, "severity", &["info", "warning", "error"], true)?;
                text(row, "description", 1, 600, true)?;
                strings(row, "draftExcerpts", 4, 300)?;
                strings(row, "memoryRefs", 6, 16)?;
                for reference in rows(row, "draftRefs", 0, 6, false)? {
                    text(reference, "ref", 1, 16, true)?;
                    text(reference, "excerpt", 1, 300, true)?;
                }
            }
        }
        "draft-memory" => {
            for row in rows(value, "items", 0, 20, true)? {
                choice(
                    row,
                    "category",
                    &[
                        "chapter-note",
                        "character",
                        "story-bible",
                        "timeline",
                        "thread",
                        "glossary",
                    ],
                    true,
                )?;
                text(row, "key", 0, 120, false)?;
                text(row, "title", 0, 120, false)?;
                text(row, "content", 1, 2000, true)?;
                choice(
                    row,
                    "state",
                    &["open", "advanced", "resolved", "uncertain"],
                    false,
                )?;
            }
        }
        _ => return Err("未知模型任务".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_drafts_enforce_length_without_whitespace_padding() {
        for count in [1799, 3501] {
            assert!(validate(
                "draft",
                &serde_json::json!({"title":"边界","content":"字".repeat(count)})
            )
            .is_err());
        }
        for count in [1800, 3500] {
            assert!(validate(
                "draft",
                &serde_json::json!({"title":"边界","content":"字".repeat(count)})
            )
            .is_ok());
        }
        assert!(validate_draft(&format!("{}{}", "字".repeat(100), " \n\t".repeat(2000))).is_err());
        assert!(
            validate_draft(&"😀".repeat(1800)).is_ok(),
            "字符不能按 UTF-16 单位重复计数"
        );
    }
}
