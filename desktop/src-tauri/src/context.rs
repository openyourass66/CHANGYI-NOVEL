use crate::database::{one, query, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashSet;

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
    pub memories: Vec<Value>,
}

pub fn build(db: &Connection, project_id: &str, last_n: usize) -> Result<Context> {
    build_for(db, project_id, last_n, "")
}

pub fn build_for(db: &Connection, project_id: &str, last_n: usize, focus: &str) -> Result<Context> {
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
    let all = query(
        db,
        "SELECT * FROM MemoryEntry WHERE projectId=? AND isCurrent=1 ORDER BY updatedAt DESC,id",
        &[json!(project_id)],
    )?;
    let focus = format!(
        "{}\n{}",
        focus,
        chapters
            .iter()
            .rev()
            .take(last_n)
            .map(|row| row["content"].as_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n")
    );
    let memories = select_memories(&all, &focus, 12000);
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
    let mut included = 0usize;
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
            included += 1;
            lines.push(line);
        }
        if !lines.is_empty() {
            digest.push(format!("## {label}\n{}", lines.join("\n")));
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
    if all.len() > included {
        blocks.push(format!(
            "（注：按当前任务相关性选取记忆，另有 {} 条未纳入；检查结果仅覆盖提供的上下文。）",
            all.len() - included
        ));
    }
    let total_chars = blocks
        .iter()
        .map(|block| block.encode_utf16().count())
        .sum::<usize>()
        + blocks.len().saturating_sub(1) * 2;
    Ok(Context {
        text: blocks.join("\n\n"),
        total_chars,
        memory_count: included,
        chapter_count: chapters.len(),
        memory_sample: memory_text.chars().take(400).collect(),
        memories,
    })
}

// 双字片段兼顾中文人名、术语和没有空格的正文；去重后避免重复措辞放大权重。
fn terms(text: &str) -> HashSet<String> {
    let chars: Vec<char> = text.to_lowercase().chars().collect();
    chars
        .windows(2)
        .filter(|pair| pair.iter().all(|ch| ch.is_alphanumeric()))
        .map(|pair| pair.iter().collect())
        .collect()
}
fn relevance(text: &str, focus: &HashSet<String>) -> usize {
    terms(text).intersection(focus).count()
}

/// 在容量受限时保留相关原文片段，省略处明确标记，不生成或改写事实。
pub fn excerpt(text: &str, focus: &str, budget: usize) -> String {
    if text.encode_utf16().count() <= budget {
        return text.to_string();
    }
    if budget < 30 {
        return String::new();
    }
    let focus = terms(focus);
    let chars: Vec<char> = text.chars().collect();
    let chunks: Vec<String> = chars
        .chunks(160)
        .map(|chunk| chunk.iter().collect())
        .collect();
    let mut order: Vec<usize> = (0..chunks.len()).collect();
    order.sort_by_cached_key(|&i| std::cmp::Reverse(relevance(&chunks[i], &focus)));
    let mut selected = Vec::new();
    let mut used = 20;
    for index in order {
        let len = chunks[index].encode_utf16().count() + 10;
        if used + len <= budget {
            selected.push(index);
            used += len;
        }
    }
    if selected.is_empty() {
        let mut result = String::new();
        for ch in text.chars() {
            if result.encode_utf16().count() + ch.len_utf16() + 10 > budget {
                break;
            }
            result.push(ch);
        }
        return format!("{result}（节选）");
    }
    selected.sort_unstable();
    format!(
        "（节选）{}",
        selected
            .iter()
            .map(|&i| chunks[i].as_str())
            .collect::<Vec<_>>()
            .join("\n（略）\n")
    )
}

fn select_memories(all: &[Value], focus: &str, budget: usize) -> Vec<Value> {
    let query = terms(focus);
    let mut order: Vec<usize> = (0..all.len()).collect();
    order.sort_by_cached_key(|&i| {
        let row = &all[i];
        let title = format!(
            "{} {}",
            row["title"].as_str().unwrap_or(""),
            row["key"].as_str().unwrap_or("")
        );
        let baseline = match row["category"].as_str().unwrap_or("") {
            "summary" | "style" => 16,
            "thread" if row["status"] != "resolved" => 8,
            _ => 0,
        };
        std::cmp::Reverse(
            relevance(&title, &query) * 20
                + relevance(row["content"].as_str().unwrap_or(""), &query).min(80)
                + baseline,
        )
    });
    let mut selected = Vec::new();
    let mut used = 0;
    // 基础概要及文风各保留一条，其余容量按任务相关性分配。
    let mut reserved = Vec::new();
    for category in ["summary", "style"] {
        if let Some(&i) = order.iter().find(|&&i| all[i]["category"] == category) {
            reserved.push(i);
        }
    }
    let mut seen = HashSet::new();
    for i in reserved.into_iter().chain(order) {
        if !seen.insert(i) {
            continue;
        }
        let mut row = all[i].clone();
        let overhead = row["title"].as_str().unwrap_or("").encode_utf16().count()
            + row["key"].as_str().unwrap_or("").encode_utf16().count()
            + 80;
        let remaining = budget.saturating_sub(used + overhead);
        if remaining < 200 {
            continue;
        }
        let content = excerpt(
            row["content"].as_str().unwrap_or(""),
            focus,
            remaining.min(2400),
        );
        used += overhead + content.encode_utf16().count();
        row["content"] = json!(content);
        selected.push(row);
    }
    selected
}

pub struct DraftContext {
    pub text: String,
    pub drafts: Vec<Value>,
}

/// 只读取同项目、同方向的正文。写作时只允许前章；检查时可核对其他章节。
pub fn draft_history(
    db: &Connection,
    project: &str,
    plan: &str,
    index: i64,
    check: bool,
    focus: &str,
) -> Result<DraftContext> {
    let drafts = query(db, "SELECT id,\"index\",title,content,version FROM DraftChapter WHERE projectId=? AND planId=? AND \"index\"!=? AND (? OR \"index\"<?) ORDER BY \"index\"",
        &[json!(project),json!(plan),json!(index),json!(check),json!(index)])?;
    let shared_budget = if !check && drafts.len() > 1 {
        12000 / (drafts.len() - 1)
    } else {
        16000 / drafts.len().max(1)
    };
    let blocks = drafts
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let immediate = !check && i + 1 == drafts.len();
            let budget = if immediate && drafts.len() > 1 {
                4000
            } else {
                shared_budget.min(6000)
            };
            format!(
                "[D{}] 第 {} 章《{}》\n{}",
                i + 1,
                row["index"],
                row["title"].as_str().unwrap_or(""),
                history_excerpt(
                    row["content"].as_str().unwrap_or(""),
                    focus,
                    budget,
                    immediate
                )
            )
        })
        .collect::<Vec<_>>();
    Ok(DraftContext {
        text: blocks.join("\n\n"),
        drafts,
    })
}

fn history_excerpt(text: &str, focus: &str, budget: usize, keep_ending: bool) -> String {
    if !keep_ending || text.encode_utf16().count() <= budget {
        return excerpt(text, focus, budget);
    }
    let mut tail = Vec::new();
    let mut used = 0;
    for ch in text.chars().rev() {
        if used + ch.len_utf16() > 1200.min(budget / 2) {
            break;
        }
        used += ch.len_utf16();
        tail.push(ch);
    }
    format!(
        "{}\n【本章结尾】\n{}",
        excerpt(text, focus, budget.saturating_sub(used + 20)),
        tail.into_iter().rev().collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immediate_previous_chapter_keeps_ending_and_relevant_earlier_passage() {
        let text = format!(
            "玄铁令只能由掌门开启。{}此刻林舟站在门外。😀",
            "沿途风景。".repeat(2000)
        );
        let result = history_excerpt(&text, "玄铁令掌门", 4000, true);
        assert!(result.contains("玄铁令只能由掌门开启"));
        assert!(result.ends_with("此刻林舟站在门外。😀"));
        assert!(result.encode_utf16().count() <= 4000);
    }

    #[test]
    fn related_old_facts_survive_unrelated_memory_overflow() {
        let mut rows = (0..30).map(|i| json!({"id":format!("new-{i}"),"category":"summary","title":format!("无关概要{i}"),"content":"山谷里的日常。".repeat(400),"status":"inferred"})).collect::<Vec<_>>();
        rows.push(json!({"id":"old","category":"glossary","key":"玄铁令","title":"玄铁令","content":"玄铁令只能由掌门开启。","status":"confirmed"}));
        rows.push(json!({"id":"style","category":"style","title":"文风","content":"简练克制。","status":"confirmed"}));
        let selected = select_memories(&rows, "林舟拿着玄铁令寻找掌门", 12000);
        assert!(selected.iter().any(|row| row["id"] == "old"));
        assert!(selected.iter().any(|row| row["id"] == "style"));
        assert!(selected.len() < rows.len());
        assert!(
            selected
                .iter()
                .map(|row| row["content"].as_str().unwrap().encode_utf16().count())
                .sum::<usize>()
                <= 12000
        );
        assert_eq!(
            rows[0]["content"],
            "山谷里的日常。".repeat(400),
            "检索不能改写数据库条目"
        );
    }

    #[test]
    fn oversized_entry_does_not_hide_later_facts() {
        let rows = vec![
            json!({"id":"large","category":"character","title":"林舟","content":"林舟路过山谷。".repeat(3000)}),
            json!({"id":"small","category":"story-bible","title":"山谷","content":"山谷不允许生火。"}),
        ];
        let selected = select_memories(&rows, "林舟进入山谷", 4000);
        assert_eq!(selected.len(), 2);
        assert!(selected[0]["content"].as_str().unwrap().contains("节选"));
    }

    #[test]
    fn excerpt_recalls_relevant_middle_and_respects_utf16_budget() {
        let text = format!(
            "{}\n玄铁令只能由掌门开启。😀\n{}",
            "清晨山路寂静。".repeat(200),
            "山间晚风渐起。".repeat(200)
        );
        let result = excerpt(&text, "玄铁令掌门", 450);
        assert!(result.contains("玄铁令只能由掌门开启"));
        assert!(result.encode_utf16().count() <= 450);
        assert_eq!(excerpt("完整短文😀", "", 20), "完整短文😀");
    }
}
