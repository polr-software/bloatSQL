#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod storage;

use std::sync::Arc;
use storage::ConnectionsStore;
use tauri::Manager;

fn main() {
    // Initialize tracing for debug builds
    #[cfg(debug_assertions)]
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().unwrap_or_default();
            if !app_dir.exists() {
                std::fs::create_dir_all(&app_dir).ok();
            }

            let db_path = app_dir.join("connections.db");
            let store =
                Arc::new(ConnectionsStore::new(db_path).expect("Failed to initialize storage"));
            let active_connection: Arc<
                tokio::sync::Mutex<Option<Arc<dyn crate::db::DatabaseConnection>>>,
            > = Arc::new(tokio::sync::Mutex::new(None));

            app.manage(store);
            app.manage(active_connection);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::close_splashscreen,
            commands::save_connection,
            commands::get_connections,
            commands::delete_connection,
            commands::test_connection,
            commands::connect_to_database,
            commands::execute_query,
            commands::list_tables,
            commands::list_databases,
            commands::change_database,
            commands::get_current_database,
            commands::get_table_columns,
            commands::get_table_relationships,
            commands::disconnect_from_database,
            commands::export_database,
            commands::add_row,
            commands::update_cell,
            commands::delete_rows,
            commands::apply_schema_operations,
            commands::write_text_file,
            commands::ping_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
