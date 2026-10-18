use crate::database::{query, Result};
use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, path::Path};

const CONFIG: &str = ".changyi-storage.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    version: u8,
    encryption_key: String,
}

#[derive(Deserialize, Serialize)]
struct Payload {
    v: u8,
    iv: String,
    tag: String,
    ct: String,
}

fn parse_key(hex_key: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(hex_key.trim()).map_err(|_| "主密钥必须为 64 位十六进制字符。")?;
    bytes
        .try_into()
        .map_err(|_| "主密钥必须为 64 位十六进制字符。".into())
}

pub fn read_key(root: &Path) -> Result<Option<[u8; 32]>> {
    let decode = |contents: &[u8]| -> Result<[u8; 32]> {
        let config: Config =
            serde_json::from_slice(contents).map_err(|_| "工作区加密配置损坏，请从备份恢复。")?;
        if config.version != 1 {
            return Err("工作区加密配置版本不兼容。".into());
        }
        parse_key(&config.encryption_key)
    };
    let primary = fs::read(root.join(CONFIG));
    if let Ok(contents) = &primary {
        if let Ok(key) = decode(contents) {
            return Ok(Some(key));
        }
    }
    let backup = fs::read(root.join(format!("{CONFIG}.previous")));
    if let Ok(contents) = &backup {
        if let Ok(key) = decode(contents) {
            return Ok(Some(key));
        }
    }
    match (primary, backup) {
        (Err(a), Err(b))
            if a.kind() == std::io::ErrorKind::NotFound
                && b.kind() == std::io::ErrorKind::NotFound =>
        {
            Ok(None)
        }
        (Err(error), _) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        (_, Err(error)) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Err("工作区加密配置损坏，请从备份恢复。".into()),
    }
}

pub fn write_key(root: &Path, key: &[u8; 32]) -> Result<()> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let file = root.join(CONFIG);
    let temporary = root.join(format!("{CONFIG}.{}.tmp", crate::database::id()));
    let contents = serde_json::to_vec_pretty(&Config {
        version: 1,
        encryption_key: hex::encode(key),
    })
    .map_err(|e| e.to_string())?;
    fs::write(&temporary, contents).map_err(|e| e.to_string())?;
    let outcome = (|| -> Result<()> {
        if file.exists() {
            fs::copy(&file, root.join(format!("{CONFIG}.previous"))).map_err(|e| e.to_string())?;
            fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
        fs::rename(&temporary, &file).map_err(|e| e.to_string())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "主密钥无效。")?;
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let mut encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|_| "密钥加密失败。")?;
    let tag = encrypted.split_off(encrypted.len() - 16);
    serde_json::to_string(&Payload {
        v: 1,
        iv: STANDARD.encode(nonce),
        tag: STANDARD.encode(tag),
        ct: STANDARD.encode(encrypted),
    })
    .map_err(|e| e.to_string())
}

pub fn decrypt(key: &[u8; 32], stored: &str) -> Result<String> {
    let payload: Payload = serde_json::from_str(stored).map_err(|_| "模型密钥密文损坏。")?;
    if payload.v != 1 {
        return Err("模型密钥密文版本不兼容。".into());
    }
    let iv = STANDARD
        .decode(payload.iv)
        .map_err(|_| "模型密钥密文损坏。")?;
    let tag = STANDARD
        .decode(payload.tag)
        .map_err(|_| "模型密钥密文损坏。")?;
    let mut ciphertext = STANDARD
        .decode(payload.ct)
        .map_err(|_| "模型密钥密文损坏。")?;
    if iv.len() != 12 || tag.len() != 16 {
        return Err("模型密钥密文损坏。".into());
    }
    ciphertext.extend(tag);
    let plaintext = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "主密钥无效。")?
        .decrypt(Nonce::from_slice(&iv), ciphertext.as_ref())
        .map_err(|_| "模型密钥无法解密，请检查工作区主密钥。")?;
    String::from_utf8(plaintext).map_err(|_| "模型密钥文本损坏。".into())
}

fn encrypted_rows(db: &Connection) -> Result<Vec<String>> {
    Ok(query(
        db,
        "SELECT apiKeyEncrypted FROM ModelProfile WHERE apiKeyEncrypted IS NOT NULL",
        &[],
    )?
    .into_iter()
    .filter_map(|row| row["apiKeyEncrypted"].as_str().map(str::to_string))
    .collect())
}

pub fn validate_key(db: &Connection, key: &[u8; 32]) -> Result<()> {
    for value in encrypted_rows(db)? {
        decrypt(key, &value)?;
    }
    Ok(())
}

fn legacy_key(root: &Path) -> Result<Option<[u8; 32]>> {
    let mut key = None;
    for base in [root.parent().unwrap_or(root), root] {
        for name in [".env", ".env.local"] {
            let content = match fs::read_to_string(base.join(name)) {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            for line in content.lines() {
                let line = line
                    .trim_start()
                    .strip_prefix("export ")
                    .unwrap_or(line.trim_start());
                let Some((name, value)) = line.split_once('=') else {
                    continue;
                };
                if name.trim() != "APP_ENCRYPTION_KEY" {
                    continue;
                }
                let value = value
                    .split('#')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_matches(|c| c == '\'' || c == '\"')
                    .trim();
                if let Ok(parsed) = parse_key(value) {
                    key = Some(parsed);
                }
            }
        }
    }
    Ok(key)
}

pub fn ensure_key(root: &Path, db: &Connection) -> Result<[u8; 32]> {
    if let Some(key) = read_key(root)? {
        validate_key(db, &key)?;
        return Ok(key);
    }
    if !encrypted_rows(db)?.is_empty() {
        return Err("旧工作区包含加密模型密钥，请先导入原主密钥。".into());
    }
    let mut key = [0_u8; 32];
    OsRng.fill_bytes(&mut key);
    write_key(root, &key)?;
    Ok(key)
}

pub fn restore_key(root: &Path, db: &Connection, hex_key: &str) -> Result<()> {
    let key = parse_key(hex_key)?;
    validate_key(db, &key)?;
    if let Ok(Some(existing)) = read_key(root) {
        if existing == key {
            return Ok(());
        }
        if validate_key(db, &existing).is_ok() {
            return Err("工作区已有不同且有效的主密钥，不能覆盖。".into());
        }
    }
    write_key(root, &key)
}

pub fn prepare_copy(source: &Path, target: &Path, db: &Connection) -> Result<()> {
    let key = match read_key(source)? {
        Some(key) => Some(key),
        None => legacy_key(source)?,
    };
    let key = match key {
        Some(key) => {
            validate_key(db, &key)?;
            key
        }
        None if encrypted_rows(db)?.is_empty() => {
            let mut key = [0_u8; 32];
            OsRng.fill_bytes(&mut key);
            key
        }
        None => return Err("旧工作区包含加密模型密钥，请保留原 .env 或加密配置后重试。".into()),
    };
    write_key(target, &key)
}

pub fn status(root: &Path, db: &Connection) -> serde_json::Value {
    match ensure_key(root, db) {
        Ok(_) => json!({"encryptionReady":true}),
        Err(error) => json!({"encryptionReady":false,"keyError":error}),
    }
}
