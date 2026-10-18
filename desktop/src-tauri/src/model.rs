use crate::{
    database::{one, Result},
    secrets,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

pub struct Profile {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub is_local: bool,
    pub api_key: Option<String>,
}

pub fn validate_local_endpoint(base_url: &str) -> Result<()> {
    let url = url::Url::parse(base_url).map_err(|_| "服务地址格式无效。")?;
    let local = match url.host() {
        Some(url::Host::Domain(host)) => host == "localhost" || host.ends_with(".localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Some(url::Host::Ipv6(ip)) => {
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local()
        }
        None => false,
    };
    if !local {
        return Err("本地端点只能使用本机或内网地址；远端服务请关闭「本地端点」。".into());
    }
    Ok(())
}

pub fn resolve(db: &Connection, root: &Path, id: &str) -> Result<Profile> {
    let row = one(db, "SELECT * FROM ModelProfile WHERE id=?", &[json!(id)])?;
    let provider = row["provider"]
        .as_str()
        .ok_or("模型供应商无效。")?
        .to_string();
    let base_url = row["baseUrl"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(match provider.as_str() {
            "ollama" => "http://localhost:11434/v1",
            "lmstudio" => "http://localhost:1234/v1",
            "anthropic" => "https://api.anthropic.com",
            _ => "https://api.openai.com/v1",
        })
        .trim_end_matches('/')
        .to_string();
    let api_key = row["apiKeyEncrypted"]
        .as_str()
        .map(|ciphertext| secrets::decrypt(&secrets::ensure_key(root, db)?, ciphertext))
        .transpose()?;
    let is_local = row["isLocal"]
        .as_bool()
        .unwrap_or(matches!(provider.as_str(), "ollama" | "lmstudio"));
    if is_local {
        validate_local_endpoint(&base_url)?;
    }
    if !is_local && api_key.is_none() {
        return Err("该供应商需要 API 密钥。".into());
    }
    Ok(Profile {
        provider,
        model: row["model"].as_str().ok_or("模型名无效。")?.into(),
        base_url,
        is_local,
        api_key,
    })
}

fn extract_json(text: &str) -> Result<Value> {
    let trimmed = text.trim();
    let body = if trimmed.starts_with("```") {
        trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .unwrap_or(trimmed)
            .trim()
    } else {
        trimmed
    };
    let start = body.find('{').ok_or("模型未返回 JSON 对象。")?;
    let end = body.rfind('}').ok_or("模型未返回完整 JSON 对象。")?;
    serde_json::from_str(&body[start..=end]).map_err(|_| "模型输出不是有效 JSON。".into())
}

pub fn request_json(
    profile: &Profile,
    system: &str,
    prompt: &str,
    max_tokens: u32,
    task: &str,
) -> Result<(Value, Value)> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("无法初始化模型请求：{e}"))?;
    let mut messages = vec![
        json!({"role":"system","content":format!("{system}\n\n只输出一个 JSON 对象；不要输出解释、不要使用 Markdown 代码块。")}),
        json!({"role":"user","content":prompt}),
    ];
    let mut last_error = String::new();
    for attempt in 0..2 {
        let request = if profile.provider == "anthropic" {
            client
                .post(format!("{}/v1/messages", profile.base_url))
                .header("x-api-key", profile.api_key.as_deref().unwrap_or(""))
                .header("anthropic-version", "2023-06-01")
                .json(&json!({"model":profile.model,"max_tokens":max_tokens,
                    "system":messages[0]["content"],"messages":messages[1..],"temperature":0.2}))
        } else {
            let mut body = json!({"model":profile.model,"messages":messages,"temperature":0.2,
                "max_tokens":max_tokens,"response_format":{"type":"json_object"}});
            if last_error == "模型响应缺少内容。" {
                body["thinking"] = json!({"type":"disabled"});
                body["max_tokens"] = json!(max_tokens.max(8192));
            }
            let request = client
                .post(format!("{}/chat/completions", profile.base_url))
                .json(&body);
            if let Some(api_key) = &profile.api_key {
                request.bearer_auth(api_key)
            } else {
                request
            }
        };
        let response = request
            .send()
            .map_err(|e| format!("无法连接模型接口：{e}"))?;
        let status = response.status();
        let text = response
            .text()
            .map_err(|e| format!("读取模型响应失败：{e}"))?;
        if !status.is_success() {
            return Err(format!(
                "模型接口返回 {}：{}",
                status.as_u16(),
                text.chars().take(300).collect::<String>()
            ));
        }
        let data: Value = serde_json::from_str(&text).map_err(|_| "模型响应不是有效 JSON。")?;
        let content = if profile.provider == "anthropic" {
            data["content"]
                .as_array()
                .and_then(|items| items.iter().find_map(|item| item["text"].as_str()))
        } else {
            data["choices"][0]["message"]["content"].as_str()
        };
        let content = content.filter(|value| !value.trim().is_empty());
        if content.is_none() {
            let official_deepseek = url::Url::parse(&profile.base_url)
                .ok()
                .is_some_and(|url| url.host_str() == Some("api.deepseek.com"));
            let reason = data["choices"][0]["finish_reason"].as_str().unwrap_or("");
            if attempt == 0 && official_deepseek && !["content_filter", "aborted"].contains(&reason)
            {
                last_error = "模型响应缺少内容。".into();
                messages.push(json!({"role":"user","content":"请直接输出非空 JSON 对象，以 { 开始、以 } 结束；不要解释。"}));
                continue;
            }
            return Err(if reason == "length" {
                "模型输出达到长度上限，未返回正文。请缩小任务范围。"
            } else if reason == "content_filter" {
                "模型未返回正文：内容被模型服务过滤。"
            } else {
                "模型响应缺少内容。"
            }
            .into());
        }
        let content = content.unwrap();
        match extract_json(content).and_then(|parsed| {
            crate::model_schema::validate(task, &parsed)?;
            Ok(parsed)
        }) {
            Ok(parsed) => {
                let usage = if profile.provider == "anthropic" {
                    json!({"promptTokens":data["usage"]["input_tokens"],"completionTokens":data["usage"]["output_tokens"],
                        "totalTokens":data["usage"]["input_tokens"].as_u64().unwrap_or(0)+data["usage"]["output_tokens"].as_u64().unwrap_or(0)})
                } else {
                    json!({"promptTokens":data["usage"]["prompt_tokens"],"completionTokens":data["usage"]["completion_tokens"],
                        "totalTokens":data["usage"]["total_tokens"]})
                };
                return Ok((parsed, usage));
            }
            Err(error) => {
                last_error = error;
                if attempt == 0 {
                    messages.push(json!({"role":"assistant","content":content.chars().take(4000).collect::<String>()}));
                    messages.push(json!({"role":"user","content":format!("上一次输出无法解析：{last_error}。请仅重新输出符合要求的 JSON 对象。")}));
                }
            }
        }
    }
    Err(last_error)
}
