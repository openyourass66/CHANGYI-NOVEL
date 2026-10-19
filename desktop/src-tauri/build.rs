fn main() {
    #[cfg(feature = "desktop")]
    tauri_build::build();

    #[cfg(all(feature = "desktop", windows, target_env = "gnu"))]
    {
        let resources = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("libresource.a");
        println!("cargo:rustc-link-arg-examples={}", resources.display());
    }
}
