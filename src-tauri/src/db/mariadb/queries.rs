use super::types::{
    escape_identifier, escape_string, mysql_value_to_json, value_to_option_i64,
    value_to_option_string, value_to_string,
};
use super::MariaDbConnection;
use crate::db::connection::{
    error_codes, DbResult, QueryError, QueryResult, TableColumn, TableRelationship,
    DEFAULT_QUERY_TIMEOUT, MAX_QUERY_ROWS,
};
use mysql_async::{prelude::*, Value};
use tokio::time::timeout;
use tracing::debug;

impl MariaDbConnection {
    pub(super) async fn impl_test_connection(&self) -> DbResult<()> {
        let mut conn = self.get_conn().await?;

        timeout(DEFAULT_QUERY_TIMEOUT, conn.ping())
            .await
            .map_err(|_| QueryError::with_code("Connection test timed out", error_codes::TIMEOUT_ERROR))?
            .map_err(QueryError::for_connection)?;

        Ok(())
    }

    pub(super) async fn impl_execute_query(&self, query: &str) -> DbResult<QueryResult> {
        let mut conn = self.get_conn().await?;
        let start = std::time::Instant::now();

        let statements: Vec<&str> =
            query.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();

        let is_multi = statements.len() > 1;

        if is_multi {
            for stmt in &statements[..statements.len() - 1] {
                timeout(DEFAULT_QUERY_TIMEOUT, conn.exec_drop(*stmt, ()))
                    .await
                    .map_err(|_| QueryError::timed_out())?
                    .map_err(QueryError::for_query)?;
            }
        }

        let last_stmt =
            if is_multi { statements[statements.len() - 1] } else { query.trim() };

        let result = timeout(DEFAULT_QUERY_TIMEOUT, conn.query_iter(last_stmt))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        let columns: Vec<String> = result
            .columns()
            .map(|cols| cols.iter().map(|col| col.name_str().to_string()).collect())
            .unwrap_or_default();

        let mut result_rows: Vec<serde_json::Value> = Vec::with_capacity(1000);
        let mut row_count = 0;
        let mut truncated = false;
        let column_count = columns.len();

        let mut result = result;
        while let Some(row) = result.next().await.map_err(QueryError::for_query)? {
            row_count += 1;

            if row_count > MAX_QUERY_ROWS {
                truncated = true;
                continue;
            }

            let mut row_map = serde_json::Map::with_capacity(column_count);
            for (i, col) in columns.iter().enumerate() {
                let value: Value = row.get(i).unwrap_or(Value::NULL);
                row_map.insert(col.clone(), mysql_value_to_json(value));
            }
            result_rows.push(serde_json::Value::Object(row_map));
        }

        Ok(QueryResult {
            columns,
            rows: result_rows,
            row_count,
            execution_time: start.elapsed().as_millis(),
            truncated,
        })
    }

    pub(super) async fn impl_list_tables(&self) -> DbResult<Vec<String>> {
        let mut conn = self.get_conn().await?;

        let mut result = timeout(DEFAULT_QUERY_TIMEOUT, conn.query_iter("SHOW TABLES"))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        let mut tables: Vec<String> = Vec::with_capacity(100);
        while let Some(row) = result.next().await.map_err(QueryError::for_query)? {
            tables.push(row.get(0).unwrap_or_default());
        }

        Ok(tables)
    }

    pub(super) async fn impl_list_databases(&self) -> DbResult<Vec<String>> {
        let mut conn = self.pool.get_conn().await.map_err(QueryError::for_connection)?;

        let mut result = timeout(DEFAULT_QUERY_TIMEOUT, conn.query_iter("SHOW DATABASES"))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        let mut databases: Vec<String> = Vec::with_capacity(20);
        while let Some(row) = result.next().await.map_err(QueryError::for_query)? {
            databases.push(row.get(0).unwrap_or_default());
        }

        Ok(databases)
    }

    pub(super) async fn impl_change_database(&self, database_name: &str) -> DbResult<()> {
        let mut conn = self.pool.get_conn().await.map_err(QueryError::for_connection)?;

        let query = format!("USE `{}`", escape_identifier(database_name));
        conn.query_drop(&query).await.map_err(QueryError::for_query)?;

        let mut current_db = self.current_database.lock().await;
        *current_db = database_name.to_string();

        debug!("Changed database to: {}", database_name);
        Ok(())
    }

    pub(super) async fn impl_get_current_database(&self) -> DbResult<String> {
        Ok(self.current_database.lock().await.clone())
    }

    pub(super) async fn impl_get_table_columns(
        &self,
        table_name: &str,
    ) -> DbResult<Vec<TableColumn>> {
        let mut conn = self.get_conn().await?;

        let db_name: String = conn
            .query_first("SELECT DATABASE()")
            .await
            .map_err(QueryError::for_query)?
            .unwrap_or_default();

        let query = "SELECT
                        c.COLUMN_NAME,
                        c.COLUMN_TYPE,
                        c.IS_NULLABLE,
                        c.COLUMN_KEY,
                        c.COLUMN_DEFAULT,
                        c.CHARACTER_MAXIMUM_LENGTH,
                        c.NUMERIC_PRECISION
                     FROM information_schema.COLUMNS c
                     WHERE c.TABLE_SCHEMA = ?
                        AND c.TABLE_NAME = ?
                     ORDER BY c.ORDINAL_POSITION";

        let mut result = timeout(
            DEFAULT_QUERY_TIMEOUT,
            conn.exec_iter(query, (&db_name, table_name)),
        )
        .await
        .map_err(|_| QueryError::timed_out())?
        .map_err(QueryError::for_query)?;

        let mut columns: Vec<TableColumn> = Vec::with_capacity(50);

        while let Some(row) = result.next().await.map_err(QueryError::for_query)? {
            columns.push(TableColumn {
                name: value_to_string(row.get(0).unwrap_or(Value::NULL)),
                data_type: value_to_string(row.get(1).unwrap_or(Value::NULL)),
                is_nullable: value_to_string(row.get(2).unwrap_or(Value::NULL)) == "YES",
                is_primary_key: value_to_string(row.get(3).unwrap_or(Value::NULL)) == "PRI",
                column_default: value_to_option_string(row.get(4).unwrap_or(Value::NULL)),
                character_maximum_length: value_to_option_i64(row.get(5).unwrap_or(Value::NULL)),
                numeric_precision: value_to_option_i64(row.get(6).unwrap_or(Value::NULL)),
            });
        }

        Ok(columns)
    }

    pub(super) async fn impl_get_table_relationships(&self) -> DbResult<Vec<TableRelationship>> {
        let mut conn = self.get_conn().await?;

        let db_name: String = conn
            .query_first("SELECT DATABASE()")
            .await
            .map_err(QueryError::for_query)?
            .unwrap_or_default();

        let query = "SELECT
                        kcu.TABLE_NAME,
                        kcu.COLUMN_NAME,
                        kcu.REFERENCED_TABLE_NAME,
                        kcu.REFERENCED_COLUMN_NAME,
                        kcu.CONSTRAINT_NAME
                     FROM information_schema.KEY_COLUMN_USAGE kcu
                     WHERE kcu.TABLE_SCHEMA = ?
                        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
                     ORDER BY kcu.TABLE_NAME, kcu.ORDINAL_POSITION";

        let mut result = timeout(DEFAULT_QUERY_TIMEOUT, conn.exec_iter(query, (&db_name,)))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        let mut relationships: Vec<TableRelationship> = Vec::new();

        while let Some(row) = result.next().await.map_err(QueryError::for_query)? {
            relationships.push(TableRelationship {
                from_table: row.get(0).unwrap_or_default(),
                from_column: row.get(1).unwrap_or_default(),
                to_table: row.get(2).unwrap_or_default(),
                to_column: row.get(3).unwrap_or_default(),
                constraint_name: row.get(4).unwrap_or_default(),
            });
        }

        Ok(relationships)
    }

    pub(super) async fn impl_update_cell(
        &self,
        table_name: &str,
        column_name: &str,
        new_value: Option<&str>,
        primary_key_column: &str,
        primary_key_value: &str,
    ) -> DbResult<String> {
        let mut conn = self.get_conn().await?;

        let logged_query = match new_value {
            Some(value) => format!(
                "UPDATE `{}` SET `{}` = '{}' WHERE `{}` = '{}'",
                escape_identifier(table_name),
                escape_identifier(column_name),
                escape_string(value),
                escape_identifier(primary_key_column),
                escape_string(primary_key_value)
            ),
            None => format!(
                "UPDATE `{}` SET `{}` = NULL WHERE `{}` = '{}'",
                escape_identifier(table_name),
                escape_identifier(column_name),
                escape_identifier(primary_key_column),
                escape_string(primary_key_value)
            ),
        };

        match new_value {
            Some(value) => {
                let query = format!(
                    "UPDATE `{}` SET `{}` = ? WHERE `{}` = ?",
                    escape_identifier(table_name),
                    escape_identifier(column_name),
                    escape_identifier(primary_key_column)
                );
                timeout(
                    DEFAULT_QUERY_TIMEOUT,
                    conn.exec_drop(&query, (value, primary_key_value)),
                )
                .await
                .map_err(|_| QueryError::with_code("Update timed out", error_codes::TIMEOUT_ERROR))?
                .map_err(QueryError::for_query)?;
            }
            None => {
                let query = format!(
                    "UPDATE `{}` SET `{}` = NULL WHERE `{}` = ?",
                    escape_identifier(table_name),
                    escape_identifier(column_name),
                    escape_identifier(primary_key_column)
                );
                timeout(
                    DEFAULT_QUERY_TIMEOUT,
                    conn.exec_drop(&query, (primary_key_value,)),
                )
                .await
                .map_err(|_| QueryError::with_code("Update timed out", error_codes::TIMEOUT_ERROR))?
                .map_err(QueryError::for_query)?;
            }
        }

        Ok(logged_query)
    }
}
