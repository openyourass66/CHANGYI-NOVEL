pub mod analysis;
pub mod api;
pub mod context;
pub mod database;
pub mod memory;
pub mod model;
pub mod profiles;
pub mod proposals;
mod restore;
pub mod secrets;

#[cfg(feature = "desktop")]
mod desktop {
    use crate::{
        api::{self, ApiRequest, ApiResponse},
        database::{self, Result},
        secrets,
    };
    use serde_json::{json, Value};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };
    use tauri::{Manager, State};
    use tauri_plugin_dialog::DialogExt;

    pub struct Workspace {
        root: PathBuf,
        db: rusqlite::Connection,
    }
    type SharedWorkspace = Arc<Mutex<Workspace>>;

    #[tauri::command]
    async fn api_request(
        state: State<'_, SharedWorkspace>,
        request: ApiRequest,
    ) -> Result<ApiResponse> {
        let shared = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut workspace = shared.lock().map_err(|_| "工作区不可用。")?;
            let root = workspace.root.clone();
            Ok(api::request(&mut workspace.db, &root, request))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    fn get_storage(state: State<'_, SharedWorkspace>) -> Result<Value> {
        let workspace = state.lock().map_err(|_| "工作区不可用。")?;
        Ok(json!({"supported":true,"dataDir":workspace.root,"needsSetup":false}))
    }

    fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
        fs::create_dir_all(destination).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink()
                || fs::symlink_metadata(entry.path())
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
            {
                return Err("工作区包含符号链接，无法复制。".into());
            }
            if kind.is_dir() {
                copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
            } else if kind.is_file() {
                fs::copy(entry.path(), destination.join(entry.file_name()))
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    #[tauri::command]
    async fn copy_workspace(
        app: tauri::AppHandle,
        state: State<'_, SharedWorkspace>,
    ) -> Result<Option<Value>> {
        let shared = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let Some(selected) = app
                .dialog()
                .file()
                .set_title("选择要复制的长忆数据文件夹")
                .blocking_pick_folder()
            else {
                return Ok(None);
            };
            let source = selected
                .into_path()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let parent = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let target = parent.join(format!("workspace-{}", database::id()));
            let outcome = (|| -> Result<Workspace> {
                fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                database::snapshot(&source.join("app.db"), &target.join("app.db"))?;
                let db = database::open(&target)?;
                if !database::query(
                    &db,
                    "SELECT id FROM AnalysisRun WHERE status IN ('pending','running') LIMIT 1",
                    &[],
                )?
                .is_empty()
                {
                    return Err("原工作区仍有运行中的任务，请在正式版完成或取消后再复制。".into());
                }
                for row in database::query(&db, "SELECT storedPath FROM SourceDocument", &[])? {
                    let relative = row["storedPath"].as_str().ok_or("原文路径无效。")?;
                    let file = database::safe_path(&source, relative)?;
                    if !file.is_file() {
                        return Err("原文文件缺失，无法复制工作区。".into());
                    }
                }
                if source.join("projects").exists() {
                    copy_tree(&source.join("projects"), &target.join("projects"))?;
                }
                secrets::prepare_copy(&source, &target, &db)?;
                Ok(Workspace {
                    root: target.clone(),
                    db,
                })
            })();
            let workspace = match outcome {
                Ok(w) => w,
                Err(e) => {
                    let _ = fs::remove_dir_all(&target);
                    return Err(e);
                }
            };
            // 先保存指针，成功后再切换；旧工作区和源目录均保留。
            let config = parent.join("workspace-path.json");
            let temporary = parent.join(format!("workspace-path-{}.tmp", database::id()));
            fs::write(
                &temporary,
                serde_json::to_vec(&json!({"dataDir":target})).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            fs::rename(&temporary, &config).map_err(|e| e.to_string())?;
            *shared.lock().map_err(|_| "工作区不可用。")? = workspace;
            Ok(Some(json!({"dataDir":target})))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    async fn save_export(
        app: tauri::AppHandle,
        state: State<'_, SharedWorkspace>,
        project_id: String,
        format: String,
    ) -> Result<bool> {
        if !["json", "txt", "memory-md"].contains(&format.as_str()) {
            return Err("不支持的导出格式。".into());
        }
        let shared = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let value = {
                let mut workspace = shared.lock().map_err(|_| "工作区不可用。")?;
                let root = workspace.root.clone();
                api::dispatch(
                    &mut workspace.db,
                    &root,
                    &ApiRequest {
                        method: "GET".into(),
                        path: if format == "memory-md" {
                            format!("/api/projects/{project_id}/memory/export")
                        } else {
                            format!("/api/projects/{project_id}/export?format={format}")
                        },
                        body: Value::Null,
                    },
                )?
            };
            let suggested = value["fileName"]
                .as_str()
                .unwrap_or("project.json")
                .chars()
                .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
                .collect::<String>();
            let Some(file) = app
                .dialog()
                .file()
                .set_file_name(suggested)
                .blocking_save_file()
            else {
                return Ok(false);
            };
            fs::write(
                file.into_path().map_err(|e| e.to_string())?,
                value["text"].as_str().ok_or("导出失败。")?,
            )
            .map_err(|e| e.to_string())?;
            Ok(true)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub fn run() {
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_single_instance::init(|app, _, _| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }))
            .setup(|app| {
                let parent = app.path().app_data_dir()?;
                fs::create_dir_all(&parent)?;
                let config = parent.join("workspace-path.json");
                let root = if config.is_file() {
                    let value: Value = serde_json::from_slice(&fs::read(config)?)?;
                    PathBuf::from(value["dataDir"].as_str().ok_or("工作区配置无效。")?)
                } else {
                    parent.join("workspace")
                };
                let db = database::open(&root).map_err(std::io::Error::other)?;
                app.manage(Arc::new(Mutex::new(Workspace { root, db })));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                api_request,
                get_storage,
                copy_workspace,
                save_export
            ])
            .run(tauri::generate_context!())
            .expect("无法启动长忆，请检查工作区和系统 WebView2。");
    }
}

#[cfg(feature = "desktop")]
pub use desktop::run;
