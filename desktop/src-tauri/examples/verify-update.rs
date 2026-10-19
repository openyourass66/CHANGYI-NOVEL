//! Verify the public updater endpoint with the same native plugin as the application.
use std::{path::PathBuf, time::Duration};
use tauri_plugin_updater::UpdaterExt;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let version = args.get(1).ok_or("usage: verify-update <current-version> <output.exe> [installed.exe]")?;
    let output = PathBuf::from(args.get(2).ok_or("missing download output")?);
    let mut context = tauri::generate_context!();
    context.package_info_mut().version = version.parse()?;
    context.config_mut().identifier = "com.changyi.update-verification".into();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)?;
    tauri::async_runtime::block_on(async {
        let mut builder = app.updater_builder().timeout(Duration::from_secs(120)).restart_after_install(false);
        if let Some(path) = args.get(3) {
            let installed = PathBuf::from(path).canonicalize()?;
            if !installed.is_file() { return Err("installed executable does not exist".into()); }
            builder = builder.executable_path(installed);
        }
        let updater = builder.build()?;
        let Some(update) = updater.check().await? else {
            println!("No update available for {version}");
            return Ok::<(), Box<dyn std::error::Error>>(());
        };
        println!("Public update detected: {} -> {}", update.current_version, update.version);
        let bytes = update.download(|_, _| {}, || {}).await?;
        std::fs::write(&output, &bytes)?;
        println!("Downloaded and signature verified: {} bytes", bytes.len());
        if args.get(3).is_some() {
            println!("Starting real installer; automatic restart disabled");
            update.install(&bytes)?;
        }
        Ok(())
    })
}
