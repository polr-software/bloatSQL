use crate::db::connection::{
    AddRowValue, QueryError, SchemaMutationResult, SchemaOperation, SchemaOperationType,
};
use crate::db::{create_connection, DatabaseConnection, QueryResult, TableColumn, TableRelationship};
use crate::storage::{ConnectionsStore, StoredConnection};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Manager, WebviewWindow};
use tokio::sync::Mutex;
use tracing::debug;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub password: String,
    pub database: String,
    pub ssl_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub include_drop: bool,
    pub include_create: bool,
    pub data_mode: String,
    pub selected_tables: Vec<String>,
    pub output_path: String,
    pub file_name: String,
    pub max_insert_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRowRequest {
    pub table_name: String,
    pub values: Vec<AddRowValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCellRequest {
    pub table_name: String,
    pub column_name: String,
    pub new_value: Option<String>,
    pub primary_key_column: String,
    pub primary_key_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteRowsRequest {
    pub table_name: String,
    pub primary_key_column: String,
    pub primary_key_values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplySchemaOperationsRequest {
    pub table_name: String,
    pub operations: Vec<SchemaOperation>,
}

pub type ActiveConnection = Arc<Mutex<Option<Arc<dyn DatabaseConnection>>>>;

/// Acquires the active connection, releases the lock, then calls `f`.
/// The lock is released before awaiting `f`, improving concurrency.
async fn with_active_conn<T, F, Fut>(
    active_conn: &ActiveConnection,
    f: F,
) -> Result<T, String>
where
    F: FnOnce(Arc<dyn DatabaseConnection>) -> Fut,
    Fut: std::future::Future<Output = Result<T, QueryError>>,
{
    let conn = {
        let active = active_conn.lock().await;
        active.as_ref().map(Arc::clone).ok_or_else(|| "No active connection".to_string())?
    };
    f(conn).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn close_splashscreen(window: WebviewWindow) {
    if let Some(splashscreen) = window.get_webview_window("splashscreen") {
        let _ = splashscreen.close();
    }
    if let Some(main) = window.get_webview_window("main") {
        let _ = main.show();
    }
}

#[tauri::command]
pub async fn save_connection(
    store: tauri::State<'_, Arc<ConnectionsStore>>,
    conn: Connection,
) -> Result<Connection, String> {
    let stored = StoredConnection {
        id: conn.id.clone(),
        name: conn.name.clone(),
        db_type: conn.db_type.clone(),
        host: conn.host.clone(),
        port: conn.port,
        username: conn.username.clone(),
        password_encrypted: conn.password.clone(),
        database: conn.database.clone(),
        ssl_mode: conn.ssl_mode.clone(),
    };

    store.save_connection(stored).map_err(|e| e.to_string())?;

    debug!("Saved connection: {}", conn.name);
    Ok(conn)
}

#[tauri::command]
pub async fn get_connections(
    store: tauri::State<'_, Arc<ConnectionsStore>>,
) -> Result<Vec<Connection>, String> {
    let stored_connections = store.get_all_connections().map_err(|e| e.to_string())?;

    Ok(stored_connections
        .into_iter()
        .map(|sc| Connection {
            id: sc.id,
            name: sc.name,
            db_type: sc.db_type,
            host: sc.host,
            port: sc.port,
            username: sc.username,
            password: sc.password_encrypted,
            database: sc.database,
            ssl_mode: sc.ssl_mode,
        })
        .collect())
}

#[tauri::command]
pub async fn delete_connection(
    store: tauri::State<'_, Arc<ConnectionsStore>>,
    id: String,
) -> Result<bool, String> {
    let result = store.delete_connection(&id).map_err(|e| e.to_string())?;
    debug!("Deleted connection: {}", id);
    Ok(result)
}

#[tauri::command]
pub async fn test_connection(conn: Connection) -> Result<(), String> {
    let db_conn = create_connection(
        &conn.db_type,
        &conn.host,
        conn.port as u16,
        &conn.username,
        &conn.password,
        &conn.database,
        &conn.ssl_mode,
    )
    .await
    .map_err(|e| e.message)?;

    db_conn.test_connection().await.map_err(|e| e.message)?;
    debug!("Connection test successful: {}", conn.name);
    Ok(())
}

#[tauri::command]
pub async fn connect_to_database(
    conn: Connection,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<(), String> {
    let db_conn = create_connection(
        &conn.db_type,
        &conn.host,
        conn.port as u16,
        &conn.username,
        &conn.password,
        &conn.database,
        &conn.ssl_mode,
    )
    .await
    .map_err(|e| e.message)?;

    let mut active = active_conn.lock().await;
    *active = Some(db_conn);

    debug!("Connected to database: {}", conn.name);
    Ok(())
}

#[tauri::command]
pub async fn execute_query(
    query: String,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<QueryResult, String> {
    with_active_conn(&active_conn, |conn| async move {
        conn.execute_query(&query).await
    })
    .await
}

#[tauri::command]
pub async fn list_tables(
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<Vec<String>, String> {
    with_active_conn(&active_conn, |conn| async move { conn.list_tables().await }).await
}

#[tauri::command]
pub async fn list_databases(
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<Vec<String>, String> {
    with_active_conn(&active_conn, |conn| async move { conn.list_databases().await }).await
}

#[tauri::command]
pub async fn change_database(
    database_name: String,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<(), String> {
    debug!("Changed database to: {}", database_name);
    with_active_conn(&active_conn, |conn| async move {
        conn.change_database(&database_name).await
    })
    .await
}

#[tauri::command]
pub async fn get_current_database(
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<String, String> {
    with_active_conn(&active_conn, |conn| async move { conn.get_current_database().await }).await
}

#[tauri::command]
pub async fn get_table_columns(
    table_name: String,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<Vec<TableColumn>, String> {
    with_active_conn(&active_conn, |conn| async move {
        conn.get_table_columns(&table_name).await
    })
    .await
}

#[tauri::command]
pub async fn get_table_relationships(
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<Vec<TableRelationship>, String> {
    with_active_conn(&active_conn, |conn| async move { conn.get_table_relationships().await }).await
}

#[tauri::command]
pub async fn disconnect_from_database(
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<(), String> {
    let mut active = active_conn.lock().await;
    if let Some(conn) = active.take() {
        conn.disconnect().await.map_err(|e| e.message)?;
        debug!("Disconnected from database");
    }
    Ok(())
}

#[tauri::command]
pub async fn export_database(
    options: ExportOptions,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<(), String> {
    let output_path = options.output_path.clone();
    let file_name = options.file_name.clone();

    let sql_content = with_active_conn(&active_conn, |conn| async move {
        conn.export_database_with_options(
            options.include_drop,
            options.include_create,
            &options.data_mode,
            &options.selected_tables,
            options.max_insert_size,
        )
        .await
    })
    .await?;

    let file_path = std::path::Path::new(&output_path).join(&file_name);
    tokio::fs::write(&file_path, sql_content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    debug!("Exported database to: {:?}", file_path);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRowResult {
    pub success: bool,
    pub inserted_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AddRowError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_query: Option<String>,
}

/// Detailed error information for add-row failures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRowError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCellResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<UpdateCellError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_query: Option<String>,
}

/// Detailed error information for cell update failures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCellError {
    /// Human-readable error message.
    pub message: String,
    /// Database error code (e.g., PostgreSQL SQLSTATE).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Additional detail from database.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Hint on how to fix the issue.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// The table being updated.
    pub table: String,
    /// The column being updated.
    pub column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteRowsResult {
    pub success: bool,
    pub deleted_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DeleteRowsError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_query: Option<String>,
}

/// Detailed error information for row deletion failures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteRowsError {
    /// Human-readable error message.
    pub message: String,
    /// Database error code (e.g., PostgreSQL SQLSTATE).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Additional detail from database.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Hint on how to fix the issue.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// The table being updated.
    pub table: String,
    /// The primary key column used for deletion.
    pub primary_key_column: String,
}

#[tauri::command]
pub async fn add_row(
    request: AddRowRequest,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<AddRowResult, String> {
    debug!(
        "add_row called: table={}, values={}",
        request.table_name,
        request.values.len()
    );

    let conn = {
        let active = active_conn.lock().await;
        active.as_ref().map(Arc::clone)
    };

    match conn {
        Some(conn) => match conn.add_row(&request.table_name, &request.values).await {
            Ok(executed_query) => Ok(AddRowResult {
                success: true,
                inserted_count: 1,
                error: None,
                executed_query: Some(executed_query),
            }),
            Err(error) => Ok(AddRowResult {
                success: false,
                inserted_count: 0,
                error: Some(AddRowError {
                    message: error.message,
                    code: error.code,
                    detail: error.detail,
                    hint: error.hint,
                    table: request.table_name,
                }),
                executed_query: None,
            }),
        },
        None => Ok(AddRowResult {
            success: false,
            inserted_count: 0,
            error: Some(AddRowError {
                message: "No active database connection".to_string(),
                code: Some("NO_CONNECTION".to_string()),
                detail: None,
                hint: Some("Please connect to a database first".to_string()),
                table: request.table_name,
            }),
            executed_query: None,
        }),
    }
}

/// Updates a single cell value in a table.
///
/// Returns a structured result with detailed error information on failure.
#[tauri::command]
pub async fn update_cell(
    request: UpdateCellRequest,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<UpdateCellResult, String> {
    debug!("update_cell called with request: {:?}", request);

    let conn = {
        let active = active_conn.lock().await;
        active.as_ref().map(Arc::clone)
    }; // lock released before await

    match conn {
        Some(conn) => {
            debug!(
                "Executing update: table={}, column={}, pk_column={}, pk_value={}, new_value={:?}",
                request.table_name,
                request.column_name,
                request.primary_key_column,
                request.primary_key_value,
                request.new_value
            );

            match conn
                .update_cell(
                    &request.table_name,
                    &request.column_name,
                    request.new_value.as_deref(),
                    &request.primary_key_column,
                    &request.primary_key_value,
                )
                .await
            {
                Ok(executed_query) => {
                    debug!(
                        "Successfully updated cell in {}.{} where {} = {} to {:?}",
                        request.table_name,
                        request.column_name,
                        request.primary_key_column,
                        request.primary_key_value,
                        request.new_value
                    );
                    Ok(UpdateCellResult {
                        success: true,
                        error: None,
                        executed_query: Some(executed_query),
                    })
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to update {}.{}: {} (code: {:?}, detail: {:?}, hint: {:?})",
                        request.table_name,
                        request.column_name,
                        e.message,
                        e.code,
                        e.detail,
                        e.hint
                    );
                    Ok(UpdateCellResult {
                        success: false,
                        error: Some(UpdateCellError {
                            message: e.message,
                            code: e.code,
                            detail: e.detail,
                            hint: e.hint,
                            table: request.table_name,
                            column: request.column_name,
                        }),
                        executed_query: None,
                    })
                }
            }
        }
        None => {
            tracing::error!("No active database connection");
            Ok(UpdateCellResult {
                success: false,
                error: Some(UpdateCellError {
                    message: "No active database connection".to_string(),
                    code: Some("NO_CONNECTION".to_string()),
                    detail: None,
                    hint: Some("Please connect to a database first".to_string()),
                    table: request.table_name,
                    column: request.column_name,
                }),
                executed_query: None,
            })
        }
    }
}

#[tauri::command]
pub async fn delete_rows(
    request: DeleteRowsRequest,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<DeleteRowsResult, String> {
    debug!(
        "delete_rows called: table={}, pk_column={}, values={}",
        request.table_name,
        request.primary_key_column,
        request.primary_key_values.len()
    );

    let conn = {
        let active = active_conn.lock().await;
        active.as_ref().map(Arc::clone)
    };

    match conn {
        Some(conn) => {
            match conn
                .delete_rows(
                    &request.table_name,
                    &request.primary_key_column,
                    &request.primary_key_values,
                )
                .await
            {
                Ok(deleted_count) => Ok(DeleteRowsResult {
                    success: true,
                    deleted_count,
                    error: None,
                    executed_query: Some(build_delete_rows_preview_query(&request)),
                }),
                Err(error) => Ok(DeleteRowsResult {
                    success: false,
                    deleted_count: 0,
                    error: Some(DeleteRowsError {
                        message: error.message,
                        code: error.code,
                        detail: error.detail,
                        hint: error.hint,
                        table: request.table_name,
                        primary_key_column: request.primary_key_column,
                    }),
                    executed_query: None,
                }),
            }
        }
        None => Ok(DeleteRowsResult {
            success: false,
            deleted_count: 0,
            error: Some(DeleteRowsError {
                message: "No active database connection".to_string(),
                code: Some("NO_CONNECTION".to_string()),
                detail: None,
                hint: Some("Please connect to a database first".to_string()),
                table: request.table_name,
                primary_key_column: request.primary_key_column,
            }),
            executed_query: None,
        }),
    }
}

#[tauri::command]
pub async fn apply_schema_operations(
    request: ApplySchemaOperationsRequest,
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<SchemaMutationResult, String> {
    debug!(
        "apply_schema_operations called: table={}, operations={}",
        request.table_name,
        request.operations.len()
    );

    let conn = {
        let active = active_conn.lock().await;
        active.as_ref().map(Arc::clone)
    };

    match conn {
        Some(conn) => match conn
            .apply_schema_operations(&request.table_name, &request.operations)
            .await
        {
            Ok(result) => Ok(result),
            Err(error) => Ok(SchemaMutationResult {
                success: false,
                total_operations: request.operations.len(),
                executed_operations: 0,
                rolled_back: false,
                failure: Some(crate::db::connection::SchemaMutationFailure {
                    failed_operation_index: 0,
                    failed_operation_type: request
                        .operations
                        .first()
                        .map(|op| op.operation_type.clone())
                        .unwrap_or(SchemaOperationType::AddColumn),
                    message: error.message,
                    code: error.code,
                    detail: error.detail,
                    hint: error.hint,
                    failed_statement: None,
                }),
            }),
        },
        None => Ok(SchemaMutationResult {
            success: false,
            total_operations: request.operations.len(),
            executed_operations: 0,
            rolled_back: false,
            failure: Some(crate::db::connection::SchemaMutationFailure {
                failed_operation_index: 0,
                failed_operation_type: request
                    .operations
                    .first()
                    .map(|op| op.operation_type.clone())
                    .unwrap_or(SchemaOperationType::AddColumn),
                message: "No active database connection".to_string(),
                code: Some("NO_CONNECTION".to_string()),
                detail: None,
                hint: Some("Please connect to a database first".to_string()),
                failed_statement: None,
            }),
        }),
    }
}

#[tauri::command]
pub async fn ping_connection(
    active_conn: tauri::State<'_, ActiveConnection>,
) -> Result<u64, String> {
    let start = std::time::Instant::now();
    with_active_conn(&active_conn, |conn| async move { conn.test_connection().await }).await?;
    let elapsed = start.elapsed().as_millis() as u64;
    debug!("Connection ping: {} ms", elapsed);
    Ok(elapsed)
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    debug!("Wrote text file: {}", path);
    Ok(())
}

fn build_delete_rows_preview_query(request: &DeleteRowsRequest) -> String {
    let values_preview = request
        .primary_key_values
        .iter()
        .map(|value| format!("'{}'", value.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "DELETE FROM {} WHERE {} IN ({})",
        request.table_name, request.primary_key_column, values_preview
    )
}
