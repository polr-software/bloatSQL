use super::catalog::PostgresCatalog;
use super::types::{escape_identifier, escape_string, pg_error_to_query_error, pg_value_to_json};
use super::PostgresConnection;
use crate::db::connection::{
    error_codes, AddRowValue, DbResult, QueryError, QueryResult, SchemaColumnDefinition,
    SchemaMutationFailure, SchemaMutationResult, SchemaOperation, SchemaOperationType, TableColumn,
    TableRelationship, DEFAULT_QUERY_TIMEOUT, MAX_QUERY_ROWS,
};
use tokio::time::timeout;
use tokio_postgres::types::ToSql;
use tracing::debug;

struct PostgresInsertStatement {
    query: String,
    preview_query: String,
    params: Vec<String>,
}

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
        let catalog = PostgresCatalog::new(&client);

        timeout(DEFAULT_QUERY_TIMEOUT, catalog.load_public_table_names())
            .await
            .map_err(|_| QueryError::timed_out())?
    }

    pub(super) async fn impl_list_databases(&self) -> DbResult<Vec<String>> {
        let client = self.client.lock().await;
        let catalog = PostgresCatalog::new(&client);

        timeout(DEFAULT_QUERY_TIMEOUT, catalog.load_database_names())
            .await
            .map_err(|_| QueryError::timed_out())?
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
        let catalog = PostgresCatalog::new(&client);

        timeout(DEFAULT_QUERY_TIMEOUT, catalog.load_table_columns(table_name))
            .await
            .map_err(|_| QueryError::timed_out())?
    }

    pub(super) async fn impl_get_table_relationships(&self) -> DbResult<Vec<TableRelationship>> {
        let client = self.client.lock().await;
        let catalog = PostgresCatalog::new(&client);

        timeout(DEFAULT_QUERY_TIMEOUT, catalog.load_table_relationships())
            .await
            .map_err(|_| QueryError::timed_out())?
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

        let logged_query = match new_value {
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

        let query = match new_value {
            Some(_) => format!(
                "UPDATE \"{}\" SET \"{}\" = $1 WHERE \"{}\"::text = $2",
                escape_identifier(table_name),
                escape_identifier(column_name),
                escape_identifier(primary_key_column)
            ),
            None => format!(
                "UPDATE \"{}\" SET \"{}\" = NULL WHERE \"{}\"::text = $1",
                escape_identifier(table_name),
                escape_identifier(column_name),
                escape_identifier(primary_key_column)
            ),
        };

        debug!("Executing update query: {}", logged_query);

        match new_value {
            Some(value) => {
                timeout(DEFAULT_QUERY_TIMEOUT, client.execute(&query, &[&value, &primary_key_value]))
                    .await
                    .map_err(|_| {
                        QueryError::with_code("Update operation timed out", error_codes::TIMEOUT_ERROR)
                            .with_hint(
                                "The database took too long to respond. Try again or check database load.",
                            )
                    })?
                    .map_err(|e| pg_error_to_query_error(e, error_codes::QUERY_ERROR))?;
            }
            None => {
                timeout(DEFAULT_QUERY_TIMEOUT, client.execute(&query, &[&primary_key_value]))
                    .await
                    .map_err(|_| {
                        QueryError::with_code("Update operation timed out", error_codes::TIMEOUT_ERROR)
                            .with_hint(
                                "The database took too long to respond. Try again or check database load.",
                            )
                    })?
                    .map_err(|e| pg_error_to_query_error(e, error_codes::QUERY_ERROR))?;
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

        let client = self.client.lock().await;
        let query = format!(
            "DELETE FROM \"{}\" WHERE \"{}\"::text = ANY($1)",
            escape_identifier(table_name),
            escape_identifier(primary_key_column)
        );

        let deleted = timeout(DEFAULT_QUERY_TIMEOUT, client.execute(&query, &[&primary_key_values]))
            .await
            .map_err(|_| {
                QueryError::with_code("Delete operation timed out", error_codes::TIMEOUT_ERROR)
                    .with_hint(
                        "The database took too long to respond. Try again or check database load.",
                    )
            })?
            .map_err(|e| pg_error_to_query_error(e, error_codes::QUERY_ERROR))?;

        Ok(deleted)
    }

    pub(super) async fn impl_add_row(
        &self,
        table_name: &str,
        values: &[AddRowValue],
    ) -> DbResult<String> {
        let client = self.client.lock().await;
        let statement = build_postgres_insert_statement(table_name, values);
        let param_refs: Vec<&(dyn ToSql + Sync)> =
            statement.params.iter().map(|value| value as &(dyn ToSql + Sync)).collect();

        timeout(DEFAULT_QUERY_TIMEOUT, client.execute(&statement.query, &param_refs))
            .await
            .map_err(|_| {
                QueryError::with_code("Insert operation timed out", error_codes::TIMEOUT_ERROR)
                    .with_hint(
                        "The database took too long to respond. Try again or check database load.",
                    )
            })?
            .map_err(|error| pg_error_to_query_error(error, error_codes::QUERY_ERROR))?;

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

        let total_operations = operations.len();
        let mut executed_operations = 0;
        let mut client = self.client.lock().await;
        let transaction = client.transaction().await.map_err(QueryError::for_query)?;

        for (index, operation) in operations.iter().enumerate() {
            let statements = match build_postgres_schema_statements(table_name, operation) {
                Ok(statements) => statements,
                Err(error) => {
                    let rolled_back = rollback_postgres_transaction(transaction).await;
                    return Ok(build_schema_failure_result(
                        total_operations,
                        executed_operations,
                        index,
                        operation,
                        error,
                        None,
                        rolled_back,
                    ));
                }
            };

            for statement in statements {
                let execute_result = timeout(DEFAULT_QUERY_TIMEOUT, transaction.batch_execute(&statement))
                    .await;

                match execute_result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        let rolled_back = rollback_postgres_transaction(transaction).await;
                        return Ok(build_schema_failure_result(
                            total_operations,
                            executed_operations,
                            index,
                            operation,
                            pg_error_to_query_error(error, error_codes::QUERY_ERROR),
                            Some(statement),
                            rolled_back,
                        ));
                    }
                    Err(_) => {
                        let rolled_back = rollback_postgres_transaction(transaction).await;
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
                                "The transaction was rolled back because PostgreSQL supports transactional DDL.",
                            ),
                            Some(statement),
                            rolled_back,
                        ));
                    }
                }
            }

            executed_operations += 1;
        }

        match timeout(DEFAULT_QUERY_TIMEOUT, transaction.commit()).await {
            Ok(Ok(())) => Ok(SchemaMutationResult {
                success: true,
                total_operations,
                executed_operations,
                rolled_back: false,
                failure: None,
            }),
            Ok(Err(error)) => Ok(build_schema_failure_result(
                total_operations,
                executed_operations,
                total_operations.saturating_sub(1),
                operations.last().expect("operations is not empty"),
                pg_error_to_query_error(error, error_codes::QUERY_ERROR),
                None,
                false,
            )),
            Err(_) => Ok(build_schema_failure_result(
                total_operations,
                executed_operations,
                total_operations.saturating_sub(1),
                operations.last().expect("operations is not empty"),
                QueryError::with_code(
                    "Schema mutation commit timed out",
                    error_codes::TIMEOUT_ERROR,
                ),
                None,
                false,
            )),
        }
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

async fn rollback_postgres_transaction(
    transaction: tokio_postgres::Transaction<'_>,
) -> bool {
    transaction.rollback().await.is_ok()
}

fn build_postgres_schema_statements(
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
            let quoted_column = quote_identifier(&operation.column_name);
            let mut type_sql = definition.data_type.to_uppercase();

            if let Some(length) = definition.length.filter(|_| needs_length(&definition.data_type)) {
                type_sql.push_str(&format!("({})", length));
            }

            let mut statements = vec![format!(
                "ALTER TABLE {} ALTER COLUMN {} TYPE {}",
                quoted_table, quoted_column, type_sql
            )];

            statements.push(if definition.is_nullable {
                format!(
                    "ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL",
                    quoted_table, quoted_column
                )
            } else {
                format!(
                    "ALTER TABLE {} ALTER COLUMN {} SET NOT NULL",
                    quoted_table, quoted_column
                )
            });

            statements.push(
                if let Some(default_value) = definition.default_value.as_deref() {
                    if !default_value.is_empty() {
                        format!(
                            "ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {}",
                            quoted_table,
                            quoted_column,
                            format_default_value(default_value, &definition.data_type)
                        )
                    } else {
                        format!(
                            "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT",
                            quoted_table, quoted_column
                        )
                    }
                } else {
                    format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT",
                        quoted_table, quoted_column
                    )
                },
            );

            Ok(statements)
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
    format!("\"{}\"", escape_identifier(identifier))
}

fn build_postgres_insert_statement(table_name: &str, values: &[AddRowValue]) -> PostgresInsertStatement {
    if values.is_empty() {
        let quoted_table = quote_identifier(table_name);
        return PostgresInsertStatement {
            query: format!("INSERT INTO {} DEFAULT VALUES", quoted_table),
            preview_query: format!("INSERT INTO {} DEFAULT VALUES", quoted_table),
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
                params.push(raw_value.to_string());
                query_values.push(format!("${}", params.len()));
                preview_values.push(format!("'{}'", escape_string(raw_value)));
            }
            None => {
                query_values.push("NULL".to_string());
                preview_values.push("NULL".to_string());
            }
        }
    }

    PostgresInsertStatement {
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
    fn builds_modify_column_statements_for_postgresql() {
        let operation = SchemaOperation {
            operation_type: SchemaOperationType::ModifyColumn,
            column_name: "email".to_string(),
            new_column_name: None,
            new_definition: Some(sample_definition()),
        };

        let statements =
            build_postgres_schema_statements("users", &operation).expect("statements should build");

        assert_eq!(
            statements,
            vec![
                String::from(r#"ALTER TABLE "users" ALTER COLUMN "email" TYPE VARCHAR(255)"#),
                String::from(r#"ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL"#),
                String::from(
                    r#"ALTER TABLE "users" ALTER COLUMN "email" SET DEFAULT 'guest@example.com'"#
                ),
            ]
        );
    }

    #[test]
    fn add_column_requires_definition_for_postgresql() {
        let operation = SchemaOperation {
            operation_type: SchemaOperationType::AddColumn,
            column_name: "email".to_string(),
            new_column_name: None,
            new_definition: None,
        };

        let error = build_postgres_schema_statements("users", &operation)
            .expect_err("missing definition should fail");

        assert_eq!(error.code.as_deref(), Some(error_codes::QUERY_ERROR));
        assert_eq!(error.message, "ADD_COLUMN operation requires new_definition");
    }

    #[test]
    fn schema_failure_result_marks_rollback_for_postgresql() {
        let operation = SchemaOperation {
            operation_type: SchemaOperationType::ModifyColumn,
            column_name: "email".to_string(),
            new_column_name: None,
            new_definition: Some(sample_definition()),
        };

        let result = build_schema_failure_result(
            2,
            0,
            0,
            &operation,
            QueryError::with_code("type change failed", error_codes::QUERY_ERROR),
            Some(r#"ALTER TABLE "users" ALTER COLUMN "email" TYPE VARCHAR(255)"#.to_string()),
            true,
        );

        assert!(!result.success);
        assert!(result.rolled_back);
        assert_eq!(result.total_operations, 2);

        let failure = result.failure.expect("failure should exist");
        assert_eq!(failure.failed_operation_index, 0);
        assert!(matches!(
            failure.failed_operation_type,
            SchemaOperationType::ModifyColumn
        ));
        assert_eq!(
            failure.failed_statement.as_deref(),
            Some(r#"ALTER TABLE "users" ALTER COLUMN "email" TYPE VARCHAR(255)"#)
        );
    }

    #[test]
    fn builds_insert_statement_for_postgresql_with_defaults_and_nulls() {
        let statement = build_postgres_insert_statement(
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
            r#"INSERT INTO "users" ("id", "email", "bio") VALUES (DEFAULT, $1, NULL)"#
        );
        assert_eq!(
            statement.preview_query,
            r#"INSERT INTO "users" ("id", "email", "bio") VALUES (DEFAULT, 'guest@example.com', NULL)"#
        );
        assert_eq!(statement.params, vec![String::from("guest@example.com")]);
    }

    #[test]
    fn builds_default_values_insert_for_postgresql_when_request_is_empty() {
        let statement = build_postgres_insert_statement("audit_log", &[]);

        assert_eq!(statement.query, r#"INSERT INTO "audit_log" DEFAULT VALUES"#);
        assert_eq!(statement.preview_query, r#"INSERT INTO "audit_log" DEFAULT VALUES"#);
        assert!(statement.params.is_empty());
    }
}
