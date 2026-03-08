use super::types::{escape_identifier, escape_string, pg_error_to_query_error, pg_value_to_json};
use super::PostgresConnection;
use crate::db::connection::{
    error_codes, DbResult, QueryError, QueryResult, TableColumn, TableRelationship,
    DEFAULT_QUERY_TIMEOUT, MAX_QUERY_ROWS,
};
use tokio::time::timeout;
use tracing::debug;

impl PostgresConnection {
    pub(super) async fn impl_test_connection(&self) -> DbResult<()> {
        let client = self.client.lock().await;

        timeout(DEFAULT_QUERY_TIMEOUT, client.simple_query("SELECT 1"))
            .await
            .map_err(|_| QueryError::with_code("Connection test timed out", error_codes::TIMEOUT_ERROR))?
            .map_err(|e| QueryError::for_connection(e))?;

        Ok(())
    }

    pub(super) async fn impl_execute_query(&self, query: &str) -> DbResult<QueryResult> {
        let client = self.client.lock().await;
        let start = std::time::Instant::now();

        let trimmed = query.trim();
        let is_select = {
            let upper = trimmed.to_uppercase();
            let first_word = upper.split_whitespace().next().unwrap_or("");
            (first_word == "SELECT"
                || first_word == "WITH"
                || first_word == "SHOW"
                || first_word == "EXPLAIN")
                && !trimmed.contains(';')
        };

        if is_select {
            let rows = timeout(DEFAULT_QUERY_TIMEOUT, client.query(trimmed, &[]))
                .await
                .map_err(|_| QueryError::timed_out())?
                .map_err(|e| pg_error_to_query_error(e, error_codes::QUERY_ERROR))?;

            let columns: Vec<String> = if !rows.is_empty() {
                rows[0].columns().iter().map(|col| col.name().to_string()).collect()
            } else {
                Vec::new()
            };

            let total_rows = rows.len();
            let truncated = total_rows > MAX_QUERY_ROWS;
            let rows_to_process = if truncated { MAX_QUERY_ROWS } else { total_rows };
            let mut result_rows = Vec::with_capacity(rows_to_process);

            for row in rows.iter().take(rows_to_process) {
                let mut row_map = serde_json::Map::with_capacity(columns.len());
                for (i, col_name) in columns.iter().enumerate() {
                    let col_type = row.columns()[i].type_();
                    row_map.insert(col_name.clone(), pg_value_to_json(row, i, col_type));
                }
                result_rows.push(serde_json::Value::Object(row_map));
            }

            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count: total_rows,
                execution_time: start.elapsed().as_millis(),
                truncated,
            })
        } else {
            timeout(DEFAULT_QUERY_TIMEOUT, client.batch_execute(trimmed))
                .await
                .map_err(|_| QueryError::timed_out())?
                .map_err(|e| pg_error_to_query_error(e, error_codes::QUERY_ERROR))?;

            Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                row_count: 0,
                execution_time: start.elapsed().as_millis(),
                truncated: false,
            })
        }
    }

    pub(super) async fn impl_list_tables(&self) -> DbResult<Vec<String>> {
        let client = self.client.lock().await;

        let query = "SELECT table_name FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                     ORDER BY table_name";

        let rows = timeout(DEFAULT_QUERY_TIMEOUT, client.query(query, &[]))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        Ok(rows.iter().filter_map(|row| row.try_get::<_, String>(0).ok()).collect())
    }

    pub(super) async fn impl_list_databases(&self) -> DbResult<Vec<String>> {
        let client = self.client.lock().await;

        let query = "SELECT datname FROM pg_database
                     WHERE datistemplate = false
                     ORDER BY datname";

        let rows = timeout(DEFAULT_QUERY_TIMEOUT, client.query(query, &[]))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        Ok(rows.iter().filter_map(|row| row.try_get::<_, String>(0).ok()).collect())
    }

    pub(super) async fn impl_change_database(&self, database_name: &str) -> DbResult<()> {
        let new_client = Self::create_client(
            &self.host,
            self.port,
            &self.username,
            &self.password,
            database_name,
            &self.ssl_mode,
        )
        .await?;

        let mut client = self.client.lock().await;
        *client = new_client;

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
        let client = self.client.lock().await;

        let query = "SELECT
                        c.column_name,
                        c.udt_name,
                        c.is_nullable,
                        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary,
                        c.column_default,
                        c.character_maximum_length,
                        c.numeric_precision
                     FROM information_schema.columns c
                     LEFT JOIN (
                        SELECT ku.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku
                            ON tc.constraint_name = ku.constraint_name
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                            AND tc.table_name = $1
                            AND tc.table_schema = 'public'
                     ) pk ON c.column_name = pk.column_name
                     WHERE c.table_name = $1
                        AND c.table_schema = 'public'
                     ORDER BY c.ordinal_position";

        let rows = timeout(DEFAULT_QUERY_TIMEOUT, client.query(query, &[&table_name]))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        let columns = rows
            .iter()
            .filter_map(|row| {
                Some(TableColumn {
                    name: row.try_get::<_, String>(0).ok()?,
                    data_type: row.try_get::<_, String>(1).ok()?,
                    is_nullable: row.try_get::<_, String>(2).ok()? == "YES",
                    is_primary_key: row.try_get::<_, bool>(3).ok()?,
                    column_default: row.try_get::<_, String>(4).ok(),
                    character_maximum_length: row.try_get::<_, i32>(5).ok().map(|v| v as i64),
                    numeric_precision: row.try_get::<_, i32>(6).ok().map(|v| v as i64),
                })
            })
            .collect();

        Ok(columns)
    }

    pub(super) async fn impl_get_table_relationships(&self) -> DbResult<Vec<TableRelationship>> {
        let client = self.client.lock().await;

        let query = "SELECT
                        tc.table_name AS from_table,
                        kcu.column_name AS from_column,
                        ccu.table_name AS to_table,
                        ccu.column_name AS to_column,
                        tc.constraint_name
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                        AND tc.table_schema = kcu.table_schema
                     JOIN information_schema.constraint_column_usage ccu
                        ON ccu.constraint_name = tc.constraint_name
                        AND ccu.table_schema = tc.table_schema
                     WHERE tc.constraint_type = 'FOREIGN KEY'
                        AND tc.table_schema = 'public'
                     ORDER BY tc.table_name";

        let rows = timeout(DEFAULT_QUERY_TIMEOUT, client.query(query, &[]))
            .await
            .map_err(|_| QueryError::timed_out())?
            .map_err(QueryError::for_query)?;

        let relationships = rows
            .iter()
            .filter_map(|row| {
                Some(TableRelationship {
                    from_table: row.try_get::<_, String>(0).ok()?,
                    from_column: row.try_get::<_, String>(1).ok()?,
                    to_table: row.try_get::<_, String>(2).ok()?,
                    to_column: row.try_get::<_, String>(3).ok()?,
                    constraint_name: row.try_get::<_, String>(4).ok()?,
                })
            })
            .collect();

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
        let client = self.client.lock().await;

        let query = match new_value {
            Some(value) => format!(
                "UPDATE \"{}\" SET \"{}\" = '{}' WHERE \"{}\" = '{}'",
                escape_identifier(table_name),
                escape_identifier(column_name),
                escape_string(value),
                escape_identifier(primary_key_column),
                escape_string(primary_key_value)
            ),
            None => format!(
                "UPDATE \"{}\" SET \"{}\" = NULL WHERE \"{}\" = '{}'",
                escape_identifier(table_name),
                escape_identifier(column_name),
                escape_identifier(primary_key_column),
                escape_string(primary_key_value)
            ),
        };

        debug!("Executing update query: {}", query);

        timeout(DEFAULT_QUERY_TIMEOUT, client.simple_query(&query))
            .await
            .map_err(|_| {
                QueryError::with_code("Update operation timed out", error_codes::TIMEOUT_ERROR)
                    .with_hint(
                        "The database took too long to respond. Try again or check database load.",
                    )
            })?
            .map_err(|e| pg_error_to_query_error(e, error_codes::QUERY_ERROR))?;

        Ok(query)
    }
}
