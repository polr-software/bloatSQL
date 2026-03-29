mod export;
mod queries;
pub(super) mod types;

use crate::db::connection::{
    error_codes, AddRowValue, DatabaseConnection, DbResult, QueryError, QueryResult,
    SchemaMutationResult, SchemaOperation, TableColumn, TableRelationship,
};
use async_trait::async_trait;
use mysql_async::{prelude::*, Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// MariaDB/MySQL database connection implementation.
pub struct MariaDbConnection {
    pool: Pool,
    current_database: Arc<Mutex<String>>,
    #[allow(dead_code)]
    host: String,
    #[allow(dead_code)]
    port: u16,
    #[allow(dead_code)]
    username: String,
    #[allow(dead_code)]
    password: String,
    #[allow(dead_code)]
    ssl_mode: String,
}

impl MariaDbConnection {
    pub async fn new(
        host: &str,
        port: u16,
        user: &str,
        password: &str,
        dbname: &str,
        ssl_mode: &str,
    ) -> DbResult<Self> {
        let pool = Self::create_pool(host, port, user, password, dbname, ssl_mode).await?;

        let conn = pool.get_conn().await.map_err(|e| {
            QueryError::with_code(format!("Failed to connect: {}", e), error_codes::CONNECTION_ERROR)
        })?;
        drop(conn);

        Ok(MariaDbConnection {
            pool,
            current_database: Arc::new(Mutex::new(dbname.to_string())),
            host: host.to_string(),
            port,
            username: user.to_string(),
            password: password.to_string(),
            ssl_mode: ssl_mode.to_string(),
        })
    }

    async fn create_pool(
        host: &str,
        port: u16,
        user: &str,
        password: &str,
        dbname: &str,
        ssl_mode: &str,
    ) -> DbResult<Pool> {
        let make_opts = |enable_ssl: bool| -> Opts {
            let pool_opts =
                PoolOpts::default().with_constraints(PoolConstraints::new(1, 5).unwrap());

            let ssl_opts = if enable_ssl {
                Some(mysql_async::SslOpts::default().with_danger_accept_invalid_certs(true))
            } else {
                None
            };

            OptsBuilder::default()
                .ip_or_hostname(host)
                .tcp_port(port)
                .user(Some(user.to_string()))
                .pass(Some(password.to_string()))
                .db_name(Some(dbname.to_string()))
                .pool_opts(pool_opts)
                .ssl_opts(ssl_opts)
                .into()
        };

        if ssl_mode == "required" || ssl_mode == "preferred" {
            let pool = Pool::new(make_opts(true));

            match pool.get_conn().await {
                Ok(conn) => {
                    drop(conn);
                    debug!("MariaDB SSL connection established");
                    return Ok(pool);
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

        let pool = Pool::new(make_opts(false));
        pool.get_conn().await.map_err(|e| {
            QueryError::with_code(format!("Connection failed: {}", e), error_codes::CONNECTION_ERROR)
        })?;

        debug!("MariaDB non-SSL connection established");
        Ok(pool)
    }

    pub(super) async fn get_conn(&self) -> DbResult<mysql_async::Conn> {
        let current_db = self.current_database.lock().await.clone();

        let mut conn = self.pool.get_conn().await.map_err(|e| {
            QueryError::with_code(e.to_string(), error_codes::CONNECTION_ERROR)
        })?;

        let query =
            format!("USE `{}`", types::escape_identifier(&current_db));
        conn.query_drop(&query).await.map_err(|e| {
            QueryError::with_code(e.to_string(), error_codes::QUERY_ERROR)
        })?;

        Ok(conn)
    }
}

#[async_trait]
impl DatabaseConnection for MariaDbConnection {
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
        self.pool.clone().disconnect().await.map_err(|e| {
            QueryError::with_code(e.to_string(), error_codes::CONNECTION_ERROR)
        })?;
        debug!("MariaDB connection disconnected");
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
        self.impl_update_cell(
            table_name,
            column_name,
            new_value,
            primary_key_column,
            primary_key_value,
        )
        .await
    }

    async fn delete_rows(
        &self,
        table_name: &str,
        primary_key_column: &str,
        primary_key_values: &[String],
    ) -> DbResult<u64> {
        self.impl_delete_rows(table_name, primary_key_column, primary_key_values)
            .await
    }

    async fn add_row(&self, table_name: &str, values: &[AddRowValue]) -> DbResult<String> {
        self.impl_add_row(table_name, values).await
    }

    async fn apply_schema_operations(
        &self,
        table_name: &str,
        operations: &[SchemaOperation],
    ) -> DbResult<SchemaMutationResult> {
        self.impl_apply_schema_operations(table_name, operations).await
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
