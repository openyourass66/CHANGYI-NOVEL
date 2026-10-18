pub mod analysis;
pub mod api;
pub mod automation;
pub mod context;
pub mod continuation;
pub mod database;
mod draft_tasks;
pub mod memory;
pub mod model;
mod model_schema;
pub mod profiles;
pub mod proposals;
mod restore;
pub mod secrets;
pub mod storage;
pub mod works;
mod work_merge;

#[cfg(feature = "desktop")]
mod desktop {
    use crate::{
        api::{self, ApiRequest, ApiResponse},
        database::{self, Result},
        storage,
    };
    use serde_json::{json, Value};
    use std::{
        fs,
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    use tauri::{Manager, State};
    use tauri_plugin_dialog::DialogExt;

    pub struct Workspace {
        root: PathBuf,
        db: rusqlite::Connection,
        startup_error: Option<String>,
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
            if request.method == "POST"
                && request.path.starts_with("/api/model-profiles/")
                && request.path.ends_with("/test")
            {
                drop(workspace);
                let mut db = database::open(&root)?;
                return Ok(api::request(&mut db, &root, request));
            }
            Ok(api::request(&mut workspace.db, &root, request))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    fn get_storage(state: State<'_, SharedWorkspace>) -> Result<Value> {
        let workspace = state.lock().map_err(|_| "工作区不可用。")?;
        Ok(
            json!({"supported":true,"dataDir":workspace.root,"needsSetup":false,"startupError":workspace.startup_error}),
        )
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
                .set_title("选择要复制的长亿数据文件夹")
                .blocking_pick_folder()
            else {
                return Ok(None);
            };
            let source = selected
                .into_path()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let mut current = shared.lock().map_err(|_| "工作区不可用。")?;
            storage::ensure_idle(&current.db)?;
            let parent = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let target = parent.join(format!("workspace-{}", database::id()));
            let db = storage::copy_to(&source, &target)?;
            storage::save_pointer(&parent, &target)?;
            *current = Workspace {
                root: target.clone(),
                db,
                startup_error: None,
            };
            Ok(Some(json!({"dataDir":target})))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    async fn choose_directory(app: tauri::AppHandle) -> Result<Option<String>> {
        tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .set_title("选择数据保存文件夹")
                .blocking_pick_folder()
                .map(|selected| {
                    selected
                        .into_path()
                        .map(|path| path.to_string_lossy().into_owned())
                        .map_err(|e| e.to_string())
                })
                .transpose()
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    async fn apply_storage(
        app: tauri::AppHandle,
        state: State<'_, SharedWorkspace>,
        directory: String,
    ) -> Result<Value> {
        let shared = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut current = shared.lock().map_err(|_| "工作区不可用。")?;
            storage::ensure_idle(&current.db)?;
            let target = PathBuf::from(directory);
            let db = storage::prepare_destination(&current.root, &target)?;
            let target = target.canonicalize().map_err(|e| e.to_string())?;
            let parent = app.path().app_data_dir().map_err(|e| e.to_string())?;
            storage::save_pointer(&parent, &target)?;
            *current = Workspace {
                root: target.clone(),
                db,
                startup_error: None,
            };
            Ok(json!({"dataDir":target}))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    fn open_storage(state: State<'_, SharedWorkspace>) -> Result<()> {
        let current = state.lock().map_err(|_| "工作区不可用。")?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("explorer.exe")
                .arg(&current.root)
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new(if cfg!(target_os = "macos") {
                "open"
            } else {
                "xdg-open"
            })
            .arg(&current.root)
            .spawn()
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[tauri::command]
    async fn save_text(app: tauri::AppHandle, file_name: String, text: String) -> Result<bool> {
        if text.len() > 5 * 1024 * 1024 {
            return Err("导出文本过大。".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            let name = file_name
                .chars()
                .take(180)
                .map(|ch| if "\\/:*?\"<>|".contains(ch) { '_' } else { ch })
                .collect::<String>();
            let Some(file) = app.dialog().file().set_file_name(name).blocking_save_file() else {
                return Ok(false);
            };
            fs::write(file.into_path().map_err(|e| e.to_string())?, text)
                .map_err(|e| e.to_string())?;
            Ok(true)
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
                let configured=parent.join("workspace-path.json").exists();
                let opened=(|| -> Result<(PathBuf,rusqlite::Connection)> {
                    let root=storage::load_pointer(&parent)?;
                    if configured && !root.join("app.db").is_file(){return Err("原工作区数据库不存在或数据目录不可用。".into());}
                    let db=database::open(&root)?;
                    Ok((root,db))
                })();
                let (root,db,startup_error)=match opened {
                    Ok((root,db))=>(root,db,None),
                    Err(error)=>{
                        let root=parent.join(format!("recovery-{}",database::id()));
                        let db=database::open(&root).map_err(std::io::Error::other)?;
                        (root,db,Some(format!("原工作区未能打开：{error} 已进入临时恢复工作区，请到设置重新选择原数据文件夹。")))
                    }
                };
                app.manage(Arc::new(Mutex::new(Workspace{root,db,startup_error})));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                api_request,
                get_storage,
                copy_workspace,
                choose_directory,
                apply_storage,
                open_storage,
                save_text,
                save_export
            ])
            .run(tauri::generate_context!())
            .expect("无法启动长亿，请检查工作区和系统 WebView2。");
    }
}

#[cfg(feature = "desktop")]
pub use desktop::run;
