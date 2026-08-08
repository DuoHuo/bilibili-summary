mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::run_external,
            commands::ensure_whisper_model,
            commands::save_file,
            commands::resolve_output_dir,
            commands::write_text_file,
            commands::read_text_file,
            commands::path_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
