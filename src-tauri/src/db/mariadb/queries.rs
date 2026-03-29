use super::types::{
    escape_identifier, escape_string, mysql_value_to_json, value_to_option_i64,
    value_to_option_string, value_to_string,
};
use super::MariaDbConnection;
use crate::db::connection::{
    error_codes, AddRowValue, DbResult, QueryError, QueryResult, SchemaColumnDefinition,
    SchemaMutationFailure, SchemaMutationResult, SchemaOperation, SchemaOperationType, TableColumn,
    TableRelationship, DEFAULT_QUERY_TIMEOUT, MAX_QUERY_ROWS,
};
use mysql_async::{prelude::*, Params, Value};
use tokio::time::timeout;
use tracing::debug;

struct MariaDbInsertStatement {
    query: String,
    preview_query: String,
    params: Vec<String>,
}

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

    pub(super) async fn impl_delete_rows(
        &self,
        table_name: &str,
        primary_key_column: &str,
        primary_key_values: &[String],
    ) -> DbResult<u64> {
        if primary_key_values.is_empty() {
            return Ok(0);
        }

        let mut conn = self.get_conn().await?;
        let placeholders = vec!["?"; primary_key_values.len()].join(", ");
        let query = format!(
            "DELETE FROM `{}` WHERE `{}` IN ({})",
            escape_identifier(table_name),
            escape_identifier(primary_key_column),
            placeholders
        );

        let params = Params::Positional(
            primary_key_values
                .iter()
                .cloned()
                .map(Value::from)
                .collect(),
        );

        timeout(DEFAULT_QUERY_TIMEOUT, conn.exec_drop(&query, params))
            .await
            .map_err(|_| QueryError::with_code("Delete timed out", error_codes::TIMEOUT_ERROR))?
            .map_err(QueryError::for_query)?;

        Ok(primary_key_values.len() as u64)
    }

    pub(super) async fn impl_add_row(
        &self,
        table_name: &str,
        values: &[AddRowValue],
    ) -> DbResult<String> {
        let mut conn = self.get_conn().await?;
        let statement = build_mariadb_insert_statement(table_name, values);
        let params =
            Params::Positional(statement.params.iter().cloned().map(Value::from).collect());

        timeout(DEFAULT_QUERY_TIMEOUT, conn.exec_drop(&statement.query, params))
            .await
            .map_err(|_| QueryError::with_code("Insert timed out", error_codes::TIMEOUT_ERROR))?
            .map_err(QueryError::for_query)?;

        Ok(statement.preview_query)
    }

    pub(super) async fn impl_apply_schema_operations(
        &self,
        table_name: &str,
        operations: &[SchemaOperation],
    ) -> DbResult<SchemaMutationResult> {
        if operations.is_empty() {
            return Ok(SchemaMutationResult {
                success: true,
                total_operations: 0,
                executed_operations: 0,
                rolled_back: false,
                failure: None,
            });
        }

        let mut conn = self.get_conn().await?;
        let total_operations = operations.len();
        let mut executed_operations = 0;

        for (index, operation) in operations.iter().enumerate() {
            let statements = match build_mariadb_schema_statements(table_name, operation) {
                Ok(statements) => statements,
                Err(error) => {
                    return Ok(build_schema_failure_result(
                        total_operations,
                        executed_operations,
                        index,
                        operation,
                        error,
                        None,
                        false,
                    ));
                }
            };

            for statement in statements {
                let execute_result = timeout(DEFAULT_QUERY_TIMEOUT, conn.query_drop(&statement)).await;

                match execute_result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        return Ok(build_schema_failure_result(
                            total_operations,
                            executed_operations,
                            index,
                            operation,
                            QueryError::for_query(error),
                            Some(statement),
                            false,
                        ));
                    }
                    Err(_) => {
                        return Ok(build_schema_failure_result(
                            total_operations,
                            executed_operations,
                            index,
                            operation,
                            QueryError::with_code(
                                "Schema mutation timed out",
                                error_codes::TIMEOUT_ERROR,
                            )
                            .with_hint(
                                "MariaDB DDL may leave partial changes applied when a statement fails.",
                            ),
                            Some(statement),
                            false,
                        ));
                    }
                }
            }

            executed_operations += 1;
        }

        Ok(SchemaMutationResult {
            success: true,
            total_operations,
            executed_operations,
            rolled_back: false,
            failure: None,
        })
    }
}

fn build_schema_failure_result(
    total_operations: usize,
    executed_operations: usize,
    failed_operation_index: usize,
    operation: &SchemaOperation,
    error: QueryError,
    failed_statement: Option<String>,
    rolled_back: bool,
) -> SchemaMutationResult {
    SchemaMutationResult {
        success: false,
        total_operations,
        executed_operations,
        rolled_back,
        failure: Some(SchemaMutationFailure {
            failed_operation_index,
            failed_operation_type: operation.operation_type.clone(),
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            failed_statement,
        }),
    }
}

fn build_mariadb_schema_statements(
    table_name: &str,
    operation: &SchemaOperation,
) -> DbResult<Vec<String>> {
    let quoted_table = quote_identifier(table_name);

    match operation.operation_type {
        SchemaOperationType::AddColumn => {
            let definition = require_definition(operation, "ADD_COLUMN")?;
            Ok(vec![format!(
                "ALTER TABLE {} ADD COLUMN {} {}",
                quoted_table,
                quote_identifier(&definition.name),
                build_column_definition_sql(definition)
            )])
        }
        SchemaOperationType::DropColumn => Ok(vec![format!(
            "ALTER TABLE {} DROP COLUMN {}",
            quoted_table,
            quote_identifier(&operation.column_name)
        )]),
        SchemaOperationType::ModifyColumn => {
            let definition = require_definition(operation, "MODIFY_COLUMN")?;
            Ok(vec![format!(
                "ALTER TABLE {} MODIFY COLUMN {} {}",
                quoted_table,
                quote_identifier(&operation.column_name),
                build_column_definition_sql(definition)
            )])
        }
        SchemaOperationType::RenameColumn => {
            let new_column_name = require_new_column_name(operation)?;
            Ok(vec![format!(
                "ALTER TABLE {} RENAME COLUMN {} TO {}",
                quoted_table,
                quote_identifier(&operation.column_name),
                quote_identifier(new_column_name)
            )])
        }
    }
}

fn require_definition<'a>(
    operation: &'a SchemaOperation,
    operation_name: &str,
) -> DbResult<&'a SchemaColumnDefinition> {
    operation.new_definition.as_ref().ok_or_else(|| {
        QueryError::with_code(
            format!("{} operation requires new_definition", operation_name),
            error_codes::QUERY_ERROR,
        )
    })
}

fn require_new_column_name(operation: &SchemaOperation) -> DbResult<&str> {
    operation.new_column_name.as_deref().ok_or_else(|| {
        QueryError::with_code(
            "RENAME_COLUMN operation requires new_column_name",
            error_codes::QUERY_ERROR,
        )
    })
}

fn quote_identifier(identifier: &str) -> String {
    format!("`{}`", escape_identifier(identifier))
}

fn build_mariadb_insert_statement(table_name: &str, values: &[AddRowValue]) -> MariaDbInsertStatement {
    if values.is_empty() {
        let quoted_table = quote_identifier(table_name);
        return MariaDbInsertStatement {
            query: format!("INSERT INTO {} () VALUES ()", quoted_table),
            preview_query: format!("INSERT INTO {} () VALUES ()", quoted_table),
            params: Vec::new(),
        };
    }

    let quoted_table = quote_identifier(table_name);
    let columns_sql = values
        .iter()
        .map(|value| quote_identifier(&value.column_name))
        .collect::<Vec<_>>()
        .join(", ");

    let mut query_values = Vec::with_capacity(values.len());
    let mut preview_values = Vec::with_capacity(values.len());
    let mut params = Vec::new();

    for value in values {
        if value.use_default {
            query_values.push("DEFAULT".to_string());
            preview_values.push("DEFAULT".to_string());
            continue;
        }

        match value.value.as_deref() {
            Some(raw_value) => {
                query_values.push("?".to_string());
                preview_values.push(format!("'{}'", escape_string(raw_value)));
                params.push(raw_value.to_string());
            }
            None => {
                query_values.push("NULL".to_string());
                preview_values.push("NULL".to_string());
            }
        }
    }

    MariaDbInsertStatement {
        query: format!(
            "INSERT INTO {} ({}) VALUES ({})",
            quoted_table,
            columns_sql,
            query_values.join(", ")
        ),
        preview_query: format!(
            "INSERT INTO {} ({}) VALUES ({})",
            quoted_table,
            columns_sql,
            preview_values.join(", ")
        ),
        params,
    }
}

fn build_column_definition_sql(definition: &SchemaColumnDefinition) -> String {
    let mut parts = Vec::with_capacity(3);
    let mut type_sql = definition.data_type.to_uppercase();

    if let Some(length) = definition.length.filter(|_| needs_length(&definition.data_type)) {
        type_sql.push_str(&format!("({})", length));
    }

    parts.push(type_sql);
    parts.push(if definition.is_nullable {
        "NULL".to_string()
    } else {
        "NOT NULL".to_string()
    });

    if let Some(default_value) = definition.default_value.as_deref() {
        if !default_value.is_empty() {
            parts.push(format!(
                "DEFAULT {}",
                format_default_value(default_value, &definition.data_type)
            ));
        }
    }

    parts.join(" ")
}

fn needs_length(data_type: &str) -> bool {
    matches!(
        data_type.to_uppercase().as_str(),
        "VARCHAR"
            | "CHAR"
            | "VARBINARY"
            | "BINARY"
            | "INT"
            | "BIGINT"
            | "SMALLINT"
            | "TINYINT"
            | "MEDIUMINT"
            | "DECIMAL"
            | "NUMERIC"
            | "FLOAT"
            | "DOUBLE"
    )
}

fn format_default_value(value: &str, data_type: &str) -> String {
    let upper_value = value.to_uppercase();
    let upper_type = data_type.to_uppercase();

    if upper_value == "NULL" {
        return "NULL".to_string();
    }

    if matches!(
        upper_value.as_str(),
        "CURRENT_TIMESTAMP" | "NOW()" | "CURRENT_DATE" | "CURRENT_TIME" | "UUID()"
    ) || upper_value.starts_with("CURRENT_TIMESTAMP")
    {
        return upper_value;
    }

    if matches!(
        upper_type.as_str(),
        "INT"
            | "BIGINT"
            | "SMALLINT"
            | "TINYINT"
            | "MEDIUMINT"
            | "DECIMAL"
            | "NUMERIC"
            | "FLOAT"
            | "DOUBLE"
            | "REAL"
    ) {
        return value.to_string();
    }

    if matches!(upper_type.as_str(), "BOOLEAN" | "BOOL") {
        match value.to_lowercase().as_str() {
            "true" | "1" => return "TRUE".to_string(),
            "false" | "0" => return "FALSE".to_string(),
            _ => return value.to_string(),
        }
    }

    format!("'{}'", escape_string(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::AddRowValue;

    fn sample_definition() -> SchemaColumnDefinition {
        SchemaColumnDefinition {
            name: "email".to_string(),
            data_type: "varchar".to_string(),
            length: Some(255),
            is_nullable: false,
            is_primary_key: false,
            default_value: Some("guest@example.com".to_string()),
        }
    }

    #[test]
    fn builds_add_column_statement_for_mariadb() {
        let operation = SchemaOperation {
            operation_type: SchemaOperationType::AddColumn,
            column_name: "email".to_string(),
            new_column_name: None,
            new_definition: Some(sample_definition()),
        };

        let statements =
            build_mariadb_schema_statements("users", &operation).expect("statement should build");

        assert_eq!(
            statements,
            vec![String::from(
                "ALTER TABLE `users` ADD COLUMN `email` VARCHAR(255) NOT NULL DEFAULT 'guest@example.com'"
            )]
        );
    }

    #[test]
    fn rename_column_requires_new_column_name_for_mariadb() {
        let operation = SchemaOperation {
            operation_type: SchemaOperationType::RenameColumn,
            column_name: "old_name".to_string(),
            new_column_name: None,
            new_definition: None,
        };

        let error = build_mariadb_schema_statements("users", &operation)
            .expect_err("rename without new name should fail");

        assert_eq!(error.code.as_deref(), Some(error_codes::QUERY_ERROR));
        assert_eq!(
            error.message,
            "RENAME_COLUMN operation requires new_column_name"
        );
    }

    #[test]
    fn schema_failure_result_preserves_partial_apply_for_mariadb() {
        let operation = SchemaOperation {
            operation_type: SchemaOperationType::DropColumn,
            column_name: "legacy_col".to_string(),
            new_column_name: None,
            new_definition: None,
        };

        let result = build_schema_failure_result(
            3,
            1,
            1,
            &operation,
            QueryError::with_code("drop failed", error_codes::QUERY_ERROR),
            Some("ALTER TABLE `users` DROP COLUMN `legacy_col`".to_string()),
            false,
        );

        assert!(!result.success);
        assert!(!result.rolled_back);
        assert_eq!(result.executed_operations, 1);

        let failure = result.failure.expect("failure should exist");
        assert_eq!(failure.failed_operation_index, 1);
        assert!(matches!(
            failure.failed_operation_type,
            SchemaOperationType::DropColumn
        ));
        assert_eq!(
            failure.failed_statement.as_deref(),
            Some("ALTER TABLE `users` DROP COLUMN `legacy_col`")
        );
    }

    #[test]
    fn builds_insert_statement_for_mariadb_with_defaults_and_nulls() {
        let statement = build_mariadb_insert_statement(
            "users",
            &[
                AddRowValue {
                    column_name: "id".to_string(),
                    value: None,
                    use_default: true,
                },
                AddRowValue {
                    column_name: "email".to_string(),
                    value: Some("guest@example.com".to_string()),
                    use_default: false,
                },
                AddRowValue {
                    column_name: "bio".to_string(),
                    value: None,
                    use_default: false,
                },
            ],
        );

        assert_eq!(
            statement.query,
            "INSERT INTO `users` (`id`, `email`, `bio`) VALUES (DEFAULT, ?, NULL)"
        );
        assert_eq!(
            statement.preview_query,
            "INSERT INTO `users` (`id`, `email`, `bio`) VALUES (DEFAULT, 'guest@example.com', NULL)"
        );
        assert_eq!(statement.params, vec![String::from("guest@example.com")]);
    }

    #[test]
    fn builds_empty_insert_statement_for_mariadb_when_request_is_empty() {
        let statement = build_mariadb_insert_statement("audit_log", &[]);

        assert_eq!(statement.query, "INSERT INTO `audit_log` () VALUES ()");
        assert_eq!(statement.preview_query, "INSERT INTO `audit_log` () VALUES ()");
        assert!(statement.params.is_empty());
    }
}
