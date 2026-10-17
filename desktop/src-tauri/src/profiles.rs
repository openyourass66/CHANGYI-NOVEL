use crate::{
    database::{execute, id, now, one, query, Result},
    secrets,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

const PROVIDERS: &[&str] = &["openai-compatible", "anthropic", "ollama", "lmstudio"];

pub fn route(
    db: &mut Connection,
    root: &Path,
    method: &str,
    parts: &[&str],
    body: &Value,
) -> Option<Result<Value>> {
    let result = match (method, parts) {
        ("GET", ["api", "model-profiles"]) => list(db, root),
        ("POST", ["api", "model-profiles"]) => create(db, root, body),
        ("POST", ["api", "model-profiles", "key"]) => set_key(db, root, body),
        ("PATCH", ["api", "model-profiles", profile_id]) => update(db, root, profile_id, body),
        ("DELETE", ["api", "model-profiles", profile_id]) => delete(db, profile_id),
        ("POST", ["api", "model-profiles", profile_id, "default"]) => default(db, profile_id),
        ("POST", ["api", "model-profiles", profile_id, "test"]) => {
            test_connection(db, root, profile_id)
        }
        _ => return None,
    };
    Some(result)
}

fn field(value: &Value, name: &str, min: usize, max: usize) -> Result<String> {
    let text = value[name]
        .as_str()
        .ok_or_else(|| format!("字段格式无效：{name}"))?
        .trim();
    if !(min..=max).contains(&text.encode_utf16().count()) {
        return Err(format!("字段长度无效：{name}"));
    }
    Ok(text.to_string())
}

fn base_url(value: &Value) -> Result<Option<String>> {
    if value.is_null() {
        return Ok(None);
    }
    let text = value.as_str().ok_or("服务地址格式不正确。")?.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if text.encode_utf16().count() > 300 {
        return Err("服务地址过长。".into());
    }
    let parsed = url::Url::parse(text).map_err(|_| "服务地址格式不正确。")?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
    {
        return Err("服务地址必须是有效的 HTTP 或 HTTPS 地址。".into());
    }
    Ok(Some(text.trim_end_matches('/').to_string()))
}

fn profile(db: &Connection, profile_id: &str) -> Result<Value> {
    one(
        db,
        "SELECT * FROM ModelProfile WHERE id=?",
        &[json!(profile_id)],
    )
}

fn view(row: &Value, key: Option<&[u8; 32]>) -> Value {
    let encrypted = row["apiKeyEncrypted"].as_str();
    let masked = encrypted.map(|value| {
        key.and_then(|key| secrets::decrypt(key, value).ok())
            .map(|secret| {
                if secret.encode_utf16().count() <= 4 {
                    "••••".to_string()
                } else {
                    format!(
                        "••••••{}",
                        secret
                            .chars()
                            .rev()
                            .take(4)
                            .collect::<String>()
                            .chars()
                            .rev()
                            .collect::<String>()
                    )
                }
            })
            .unwrap_or_else(|| "••••••(无法解密)".into())
    });
    json!({
        "id":row["id"],"name":row["name"],"provider":row["provider"],"model":row["model"],
        "baseUrl":row["baseUrl"],"isLocal":row["isLocal"],"isDefault":row["isDefault"],
        "hasKey":encrypted.is_some(),"maskedKey":masked,"statusNote":row["statusNote"],
        "lastCheckedAt":row["lastCheckedAt"],"updatedAt":row["updatedAt"]
    })
}

fn list(db: &Connection, root: &Path) -> Result<Value> {
    let status = secrets::status(root, db);
    let key = secrets::read_key(root).ok().flatten();
    let rows = query(
        db,
        "SELECT * FROM ModelProfile ORDER BY isDefault DESC,updatedAt DESC",
        &[],
    )?;
    Ok(
        json!({"profiles":rows.iter().map(|row|view(row,key.as_ref())).collect::<Vec<_>>(),
        "encryptionReady":status["encryptionReady"],"keyError":status["keyError"]}),
    )
}

fn key(root: &Path, db: &Connection) -> Result<[u8; 32]> {
    secrets::ensure_key(root, db)
}

fn get_provider(body: &Value, fallback: Option<&str>) -> Result<String> {
    let provider = body["provider"]
        .as_str()
        .or(fallback)
        .ok_or("请选择模型供应商。")?;
    if !PROVIDERS.contains(&provider) {
        return Err("模型供应商无效。".into());
    }
    Ok(provider.into())
}

fn is_local(provider: &str, explicit: Option<bool>) -> bool {
    explicit.unwrap_or(matches!(provider, "ollama" | "lmstudio"))
}

fn create(db: &mut Connection, root: &Path, body: &Value) -> Result<Value> {
    let key = key(root, db)?;
    let name = field(body, "name", 1, 80)?;
    let provider = get_provider(body, None)?;
    let model = field(body, "model", 1, 120)?;
    let url = base_url(&body["baseUrl"])?;
    let local = is_local(&provider, body["isLocal"].as_bool());
    let secret = body["apiKey"].as_str().unwrap_or("").trim();
    if secret.encode_utf16().count() > 400 {
        return Err("API 密钥过长。".into());
    }
    if !local && secret.is_empty() {
        return Err("该供应商需要 API 密钥。".into());
    }
    let encrypted = if secret.is_empty() {
        None
    } else {
        Some(secrets::encrypt(&key, secret)?)
    };
    let first = query(db, "SELECT id FROM ModelProfile LIMIT 1", &[])?.is_empty();
    let profile_id = id();
    let at = now();
    execute(db,"INSERT INTO ModelProfile(id,name,provider,model,baseUrl,apiKeyEncrypted,isLocal,isDefault,taskUsageJson,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        &[json!(profile_id),json!(name),json!(provider),json!(model),json!(url),json!(encrypted),json!(local),json!(first),json!("{}"),json!(at),json!(at)])?;
    Ok(json!({"profile":view(&profile(db,&profile_id)?,Some(&key))}))
}

fn update(db: &mut Connection, root: &Path, profile_id: &str, body: &Value) -> Result<Value> {
    let key = key(root, db)?;
    let old = profile(db, profile_id)?;
    let name = if body.get("name").is_some() {
        field(body, "name", 1, 80)?
    } else {
        old["name"].as_str().unwrap_or("").into()
    };
    let provider = get_provider(body, old["provider"].as_str())?;
    let model = if body.get("model").is_some() {
        field(body, "model", 1, 120)?
    } else {
        old["model"].as_str().unwrap_or("").into()
    };
    let url = if let Some(value) = body.get("baseUrl") {
        base_url(value)?
    } else {
        old["baseUrl"].as_str().map(str::to_string)
    };
    let local = is_local(&provider, body["isLocal"].as_bool());
    let secret = body["apiKey"].as_str().unwrap_or("").trim();
    if secret.encode_utf16().count() > 400 {
        return Err("API 密钥过长。".into());
    }
    let encrypted = if body["clearApiKey"] == true {
        None
    } else if !secret.is_empty() {
        Some(secrets::encrypt(&key, secret)?)
    } else {
        old["apiKeyEncrypted"].as_str().map(str::to_string)
    };
    if !local && encrypted.is_none() {
        return Err("该供应商需要 API 密钥。".into());
    }
    execute(db,"UPDATE ModelProfile SET name=?,provider=?,model=?,baseUrl=?,apiKeyEncrypted=?,isLocal=?,updatedAt=? WHERE id=?",
        &[json!(name),json!(provider),json!(model),json!(url),json!(encrypted),json!(local),json!(now()),json!(profile_id)])?;
    Ok(json!({"profile":view(&profile(db,profile_id)?,Some(&key))}))
}

fn delete(db: &mut Connection, profile_id: &str) -> Result<Value> {
    let old = query(
        db,
        "SELECT * FROM ModelProfile WHERE id=?",
        &[json!(profile_id)],
    )?
    .into_iter()
    .next();
    let Some(old) = old else {
        return Ok(json!({"ok":true}));
    };
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(
        &tx,
        "DELETE FROM ModelProfile WHERE id=?",
        &[json!(profile_id)],
    )?;
    if old["isDefault"] == true {
        let next = query(
            &tx,
            "SELECT id FROM ModelProfile ORDER BY updatedAt DESC LIMIT 1",
            &[],
        )?
        .into_iter()
        .next();
        if let Some(next) = next {
            execute(
                &tx,
                "UPDATE ModelProfile SET isDefault=1,updatedAt=? WHERE id=?",
                &[json!(now()), next["id"].clone()],
            )?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"ok":true}))
}

fn default(db: &mut Connection, profile_id: &str) -> Result<Value> {
    profile(db, profile_id)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    execute(&tx, "UPDATE ModelProfile SET isDefault=0", &[])?;
    execute(
        &tx,
        "UPDATE ModelProfile SET isDefault=1,updatedAt=? WHERE id=?",
        &[json!(now()), json!(profile_id)],
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(json!({"ok":true}))
}

fn set_key(db: &Connection, root: &Path, body: &Value) -> Result<Value> {
    let hex_key = field(body, "key", 64, 64)?;
    secrets::restore_key(root, db, &hex_key)?;
    Ok(json!({"ok":true}))
}

fn test_connection(db: &Connection, root: &Path, profile_id: &str) -> Result<Value> {
    let row = profile(db, profile_id)?;
    let key = key(root, db)?;
    let provider = row["provider"].as_str().ok_or("供应商无效。")?;
    let model = row["model"].as_str().ok_or("模型无效。")?;
    let secret = row["apiKeyEncrypted"]
        .as_str()
        .map(|value| secrets::decrypt(&key, value))
        .transpose()?;
    let local = row["isLocal"] == true || matches!(provider, "ollama" | "lmstudio");
    let base = row["baseUrl"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or(match provider {
            "ollama" => "http://localhost:11434/v1",
            "lmstudio" => "http://localhost:1234/v1",
            "anthropic" => "https://api.anthropic.com",
            _ => "https://api.openai.com/v1",
        });
    if !local && secret.is_none() {
        return Err("该供应商需要 API 密钥。".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("无法初始化网络请求：{e}"))?;
    let prompt = "回复“ok”两个字符即可。";
    let result = (|| -> Result<String> {
        let request = if provider == "anthropic" {
            client.post(format!("{}/v1/messages",base.trim_end_matches('/')))
                .header("x-api-key",secret.as_deref().unwrap_or(""))
                .header("anthropic-version","2023-06-01")
                .json(&json!({"model":model,"max_tokens":16,"messages":[{"role":"user","content":prompt}],"temperature":0}))
        } else {
            let request=client.post(format!("{}/chat/completions",base.trim_end_matches('/')))
                .json(&json!({"model":model,"messages":[{"role":"user","content":prompt}],"max_tokens":16,"temperature":0}));
            if let Some(secret) = &secret {
                request.bearer_auth(secret)
            } else {
                request
            }
        };
        let response = request
            .send()
            .map_err(|e| format!("无法连接模型接口：{e}"))?;
        let status = response.status();
        let content = response
            .text()
            .map_err(|e| format!("读取模型响应失败：{e}"))?;
        if !status.is_success() {
            return Err(format!(
                "模型接口返回 {}：{}",
                status.as_u16(),
                content.chars().take(300).collect::<String>()
            ));
        }
        let data: Value = serde_json::from_str(&content).map_err(|_| "模型响应不是有效 JSON。")?;
        let sample = if provider == "anthropic" {
            data["content"]
                .as_array()
                .and_then(|rows| rows.iter().find_map(|row| row["text"].as_str()))
        } else {
            data["choices"][0]["message"]["content"].as_str()
        };
        sample
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .ok_or("模型响应缺少内容。".into())
    })();
    let note = match &result {
        Ok(_) => format!("✓ 正常：{model} 响应正常"),
        Err(error) => format!("✗ 失败：{error}"),
    };
    execute(
        db,
        "UPDATE ModelProfile SET statusNote=?,lastCheckedAt=?,updatedAt=? WHERE id=?",
        &[
            json!(note.chars().take(200).collect::<String>()),
            json!(now()),
            json!(now()),
            json!(profile_id),
        ],
    )?;
    result.map(|sample| json!({"ok":true,"sample":sample.chars().take(120).collect::<String>()}))
}
