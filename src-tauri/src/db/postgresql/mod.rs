mod export;
mod queries;
pub(super) mod types;

use crate::db::connection::{
    error_codes, DatabaseConnection, DbResult, QueryError, QueryResult, TableColumn,
    TableRelationship,
};
use async_trait::async_trait;
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls};
use tracing::{debug, error, warn};

/// PostgreSQL database connection implementation.
pub struct PostgresConnection {
    client: Arc<Mutex<Client>>,
    host: String,
    port: u16,
    username: String,
    password: String,
    current_database: Arc<Mutex<String>>,
    ssl_mode: String,
}

impl PostgresConnection {
    pub async fn new(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: &str,
        ssl_mode: &str,
    ) -> DbResult<Self> {
        let client =
            Self::create_client(host, port, username, password, database, ssl_mode).await?;

        Ok(PostgresConnection {
            client: Arc::new(Mutex::new(client)),
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.to_string(),
            current_database: Arc::new(Mutex::new(database.to_string())),
            ssl_mode: ssl_mode.to_string(),
        })
    }

    pub(super) async fn create_client(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: &str,
        ssl_mode: &str,
    ) -> DbResult<Client> {
        let config = format!(
            "host={} port={} user={} password={} dbname={}",
            host, port, username, password, database
        );

        if ssl_mode == "required" || ssl_mode == "preferred" {
            let connector = TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|e| {
                    QueryError::with_code(
                        format!("TLS configuration error: {}", e),
                        error_codes::TLS_ERROR,
                    )
                })?;

            let tls_connector = MakeTlsConnector::new(connector);

            match tokio_postgres::connect(&config, tls_connector).await {
                Ok((client, connection)) => {
                    tokio::spawn(async move {
                        if let Err(e) = connection.await {
                            error!("PostgreSQL TLS connection error: {}", e);
                        }
                    });
                    debug!("PostgreSQL TLS connection established");
                    return Ok(client);
                }
                Err(e) => {
                    if ssl_mode == "required" {
                        return Err(QueryError::with_code(
                            format!("SSL connection failed: {}", e),
                            error_codes::SSL_ERROR,
                        ));
                    }
                    warn!("SSL connection failed, falling back to non-SSL: {}", e);
                }
            }
        }

        let (client, connection) = tokio_postgres::connect(&config, NoTls)
            .await
            .map_err(|e| {
                QueryError::with_code(
                    format!("Connection failed: {}", e),
                    error_codes::CONNECTION_ERROR,
                )
            })?;

        tokio::spawn(async move {
            if let Err(e) = connection.await {
                error!("PostgreSQL connection error: {}", e);
            }
        });

        debug!("PostgreSQL non-SSL connection established");
        Ok(client)
    }
}

#[async_trait]
impl DatabaseConnection for PostgresConnection {
    async fn test_connection(&self) -> DbResult<()> {
        self.impl_test_connection().await
    }

    async fn execute_query(&self, query: &str) -> DbResult<QueryResult> {
        self.impl_execute_query(query).await
    }

    async fn list_tables(&self) -> DbResult<Vec<String>> {
        self.impl_list_tables().await
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        self.impl_list_databases().await
    }

    async fn change_database(&self, database_name: &str) -> DbResult<()> {
        self.impl_change_database(database_name).await
    }

    async fn get_current_database(&self) -> DbResult<String> {
        self.impl_get_current_database().await
    }

    async fn get_table_columns(&self, table_name: &str) -> DbResult<Vec<TableColumn>> {
        self.impl_get_table_columns(table_name).await
    }

    async fn get_table_relationships(&self) -> DbResult<Vec<TableRelationship>> {
        self.impl_get_table_relationships().await
    }

    async fn disconnect(&self) -> DbResult<()> {
        debug!("PostgreSQL connection disconnected");
        Ok(())
    }

    async fn update_cell(
        &self,
        table_name: &str,
        column_name: &str,
        new_value: Option<&str>,
        primary_key_column: &str,
        primary_key_value: &str,
    ) -> DbResult<String> {
        self.impl_update_cell(table_name, column_name, new_value, primary_key_column, primary_key_value)
            .await
    }

    async fn export_database_with_options(
        &self,
        include_drop: bool,
        include_create: bool,
        data_mode: &str,
        selected_tables: &[String],
        max_insert_size: usize,
    ) -> DbResult<String> {
        self.impl_export_database_with_options(
            include_drop,
            include_create,
            data_mode,
            selected_tables,
            max_insert_size,
        )
        .await
    }
}
