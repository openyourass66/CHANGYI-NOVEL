use crate::{
    database::{self, query, Result},
    secrets,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn ensure_idle(db: &Connection) -> Result<()> {
    if !query(
        db,
        "SELECT name FROM sqlite_master WHERE name='NativeWorkflow'",
        &[],
    )?
    .is_empty()
        && !query(
            db,
            "SELECT id FROM NativeWorkflow WHERE status='running' LIMIT 1",
            &[],
        )?
        .is_empty()
    {
        return Err("工作区仍有自动流程，请先完成或停止。".into());
    }
    if !query(
        db,
        "SELECT id FROM AnalysisRun WHERE status IN ('pending','running') LIMIT 1",
        &[],
    )?
    .is_empty()
    {
        return Err("工作区仍有任务未结束，请先完成或取消任务。".into());
    }
    Ok(())
}

fn validate_sources(db: &Connection, root: &Path) -> Result<()> {
    for row in query(db, "SELECT storedPath FROM SourceDocument", &[])? {
        let path = database::safe_path(root, row["storedPath"].as_str().ok_or("原文路径无效。")?)?;
        if !path.is_file() {
            return Err("原文文件缺失，无法打开或复制工作区。".into());
        }
    }
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    if fs::symlink_metadata(source)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("工作区包含符号链接，无法复制。".into());
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("工作区包含符号链接，无法复制。".into());
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn empty(path: &Path) -> Result<bool> {
    Ok(fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .next()
        .is_none())
}

pub fn copy_to(source: &Path, target: &Path) -> Result<Connection> {
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let target = target.canonicalize().map_err(|e| e.to_string())?;
    if source.starts_with(&target) || target.starts_with(&source) {
        return Err("目标目录不能与原工作区相同、互相包含。".into());
    }
    if !empty(&target)? {
        return Err("复制目标必须是空文件夹。".into());
    }
    let original =
        Connection::open_with_flags(source.join("app.db"), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
    database::validate(&original)?;
    ensure_idle(&original)?;
    validate_sources(&original, &source)?;
    let parent = target.parent().ok_or("不能使用磁盘根目录。")?;
    let stage = parent.join(format!(".changyi-copy-{}", database::id()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| -> Result<Connection> {
        database::snapshot(&source.join("app.db"), &stage.join("app.db"))?;
        let db = database::open(&stage)?;
        ensure_idle(&db)?;
        if source.join("projects").exists() {
            copy_tree(&source.join("projects"), &stage.join("projects"))?;
        }
        validate_sources(&db, &stage)?;
        secrets::prepare_copy(&source, &stage, &db)?;
        drop(db);
        if !empty(&target)? {
            return Err("目标文件夹内容已变化，请重新选择。".into());
        }
        fs::remove_dir(&target).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&stage, &target) {
            let _ = fs::create_dir(&target);
            return Err(error.to_string());
        }
        database::open(&target)
    })();
    if result.is_err()
        && stage.exists()
        && stage.parent() == Some(parent)
        && stage
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with(".changyi-copy-"))
    {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

pub fn prepare_destination(current: &Path, target: &Path) -> Result<Connection> {
    if !target.is_absolute() {
        return Err("数据目录必须是绝对路径。".into());
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let target = target.canonicalize().map_err(|e| e.to_string())?;
    let current = current.canonicalize().map_err(|e| e.to_string())?;
    if target == current {
        return database::open(&target);
    }
    if target.starts_with(&current) || current.starts_with(&target) {
        return Err("目标目录不能与当前工作区互相包含。".into());
    }
    if target.join("app.db").is_file() {
        let db = database::open(&target)?;
        ensure_idle(&db)?;
        validate_sources(&db, &target)?;
        secrets::prepare_copy(&target, &target, &db)?;
        Ok(db)
    } else if empty(&target)? {
        copy_to(&current, &target)
    } else {
        Err("所选文件夹不是长忆工作区，也不是空文件夹。".into())
    }
}

pub fn save_pointer(parent: &Path, root: &Path) -> Result<()> {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file = parent.join("workspace-path.json");
    let temp = parent.join(format!("workspace-path-{}.tmp", database::id()));
    fs::write(
        &temp,
        serde_json::to_vec(&json!({"dataDir":root})).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let valid_primary = fs::read(&file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value["dataDir"].as_str().map(PathBuf::from))
        .is_some_and(|path| path.is_absolute());
    if valid_primary {
        fs::copy(&file, parent.join("workspace-path.previous.json")).map_err(|e| e.to_string())?;
    }
    let result = fs::rename(&temp, &file).map_err(|e| e.to_string());
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub fn load_pointer(parent: &Path) -> Result<PathBuf> {
    let file = parent.join("workspace-path.json");
    if !file.exists() {
        return Ok(parent.join("workspace"));
    }
    for path in [file, parent.join("workspace-path.previous.json")] {
        if let Ok(contents) = fs::read(path) {
            if let Ok(value) = serde_json::from_slice::<Value>(&contents) {
                if let Some(root) = value["dataDir"].as_str() {
                    let root = PathBuf::from(root);
                    if root.is_absolute() {
                        return Ok(root);
                    }
                }
            }
        }
    }
    Err("工作区位置配置损坏，请重新选择数据文件夹。".into())
}
