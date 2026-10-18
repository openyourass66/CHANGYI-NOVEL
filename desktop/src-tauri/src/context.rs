use crate::database::{one, query, Result};
use rusqlite::Connection;
use serde_json::json;

const CATEGORY_ORDER: &[(&str, &str)] = &[
    ("summary", "全书概要"),
    ("thread", "悬念台账"),
    ("character", "人物"),
    ("story-bible", "设定集"),
    ("timeline", "时间线"),
    ("style", "文风"),
    ("glossary", "术语表"),
    ("outline", "续写大纲"),
    ("chapter-note", "章节笔记"),
];

pub struct Context {
    pub text: String,
    pub total_chars: usize,
    pub memory_count: usize,
    pub chapter_count: usize,
    pub memory_sample: String,
}

pub fn build(db: &Connection, project_id: &str, last_n: usize) -> Result<Context> {
    let project = one(
        db,
        "SELECT name FROM NovelProject WHERE id=?",
        &[json!(project_id)],
    )?;
    let chapters = query(
        db,
        "SELECT rawTitle,content FROM Chapter WHERE projectId=? ORDER BY sortOrder",
        &[json!(project_id)],
    )?;
    let memories=query(db,"SELECT category,key,title,content,status FROM MemoryEntry WHERE projectId=? AND isCurrent=1 ORDER BY updatedAt DESC",
        &[json!(project_id)])?;
    let mut blocks = vec![format!(
        "【作品】{}",
        project["name"].as_str().unwrap_or("未命名作品")
    )];
    if !chapters.is_empty() {
        let titles = chapters
            .iter()
            .enumerate()
            .map(|(i, row)| format!("{}. {}", i + 1, row["rawTitle"].as_str().unwrap_or("")))
            .collect::<Vec<_>>();
        blocks.push(format!("【章节目录】\n{}", titles.join("\n")));
    }
    let mut digest = Vec::new();
    let mut used = 0usize;
    let mut included = 0usize;
    let mut exhausted = false;
    for (category, label) in CATEGORY_ORDER {
        let mut lines = Vec::new();
        for entry in memories.iter().filter(|row| row["category"] == *category) {
            let title = entry["title"]
                .as_str()
                .or_else(|| entry["key"].as_str())
                .unwrap_or("（无标题）");
            let status = match entry["status"].as_str().unwrap_or("") {
                "confirmed" => "明述",
                "inferred" => "推断",
                "unknown" => "未知",
                "open" => "未解决",
                "advanced" => "推进中",
                "resolved" => "已解决",
                "uncertain" => "不确定",
                _ => "未知",
            };
            let content = entry["content"]
                .as_str()
                .unwrap_or("")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let line = format!("- {title}（{status}）：{content}");
            if used + line.encode_utf16().count() + 1 > 12000 {
                exhausted = true;
                break;
            }
            used += line.encode_utf16().count() + 1;
            included += 1;
            lines.push(line);
        }
        if !lines.is_empty() {
            digest.push(format!("## {label}\n{}", lines.join("\n")));
        }
        if exhausted {
            break;
        }
    }
    let memory_text = digest.join("\n\n");
    blocks.push(if memory_text.is_empty() {
        "【故事记忆】\n（暂无已确认的记忆条目）".into()
    } else {
        format!("【故事记忆】\n{memory_text}")
    });
    let mut recent_blocks = Vec::new();
    let mut recent_used = 0usize;
    for row in chapters.iter().rev().take(last_n) {
        let header = format!("### {}\n", row["rawTitle"].as_str().unwrap_or(""));
        let content = row["content"].as_str().unwrap_or("");
        let whole = format!("{header}{content}");
        let remaining = 8000usize.saturating_sub(recent_used);
        if whole.encode_utf16().count() + 2 <= remaining {
            recent_used += whole.encode_utf16().count() + 2;
            recent_blocks.push(whole);
            continue;
        }
        let tail_budget = remaining.saturating_sub(header.encode_utf16().count() + 20);
        if tail_budget >= 600 {
            let mut length = 0usize;
            let mut start = content.len();
            for (offset, ch) in content.char_indices().rev() {
                if length + ch.len_utf16() > tail_budget {
                    break;
                }
                length += ch.len_utf16();
                start = offset;
            }
            recent_blocks.push(format!("{header}（前文略）{}", &content[start..]));
        } else if recent_blocks.is_empty() {
            recent_blocks.push(whole);
        }
        break;
    }
    recent_blocks.reverse();
    let recent = recent_blocks.join("\n\n");
    if !recent.is_empty() {
        blocks.push(format!("【最近章节原文】\n{recent}"));
    }
    if memories.len() > included {
        blocks.push(format!(
            "（注：记忆超长，已省略 {} 条较次要条目。）",
            memories.len() - included
        ));
    }
    let total_chars = memory_text.encode_utf16().count() + recent.encode_utf16().count();
    Ok(Context {
        text: blocks.join("\n\n"),
        total_chars,
        memory_count: included,
        chapter_count: chapters.len(),
        memory_sample: memory_text.chars().take(400).collect(),
    })
}
