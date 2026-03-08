use super::types::{escape_identifier, mysql_value_to_sql};
use super::MariaDbConnection;
use crate::db::connection::{DbResult, QueryError};
use mysql_async::{prelude::*, Value};

impl MariaDbConnection {
    pub(super) async fn impl_export_database_with_options(
        &self,
        include_drop: bool,
        include_create: bool,
        data_mode: &str,
        selected_tables: &[String],
        max_insert_size: usize,
    ) -> DbResult<String> {
        let mut conn = self.get_conn().await?;
        let mut sql_content = String::with_capacity(1024 * 1024);

        let tables_to_export: Vec<String> = if selected_tables.is_empty() {
            let mut result =
                conn.query_iter("SHOW TABLES").await.map_err(QueryError::for_query)?;

            let mut tables: Vec<String> = Vec::new();
            while let Some(row) = result.next().await.map_err(QueryError::for_query)? {
                tables.push(row.get(0).unwrap_or_default());
            }
            tables
        } else {
            selected_tables.to_vec()
        };

        for table_name in tables_to_export {
            sql_content.push_str(&format!("\n-- Table: {}\n", table_name));

            if include_drop {
                sql_content.push_str(&format!(
                    "DROP TABLE IF EXISTS `{}`;\n",
                    escape_identifier(&table_name)
                ));
            }

            if include_create {
                let create_query =
                    format!("SHOW CREATE TABLE `{}`", escape_identifier(&table_name));
                let mut create_result = conn
                    .query_iter(create_query.as_str())
                    .await
                    .map_err(QueryError::for_query)?;

                if let Some(row) = create_result.next().await.map_err(QueryError::for_query)? {
                    let create_statement: String = row.get(1).unwrap_or_default();
                    sql_content.push_str(&create_statement);
                    sql_content.push_str(";\n\n");
                }
            }

            if data_mode != "no_data" {
                const BATCH_SIZE: usize = 10000;
                let mut offset: usize = 0;

                loop {
                    let data_query = format!(
                        "SELECT * FROM `{}` LIMIT {} OFFSET {}",
                        escape_identifier(&table_name),
                        BATCH_SIZE,
                        offset
                    );

                    let mut data_result = conn
                        .query_iter(data_query.as_str())
                        .await
                        .map_err(QueryError::for_query)?;

                    let columns: Vec<String> = data_result
                        .columns()
                        .map(|cols| cols.iter().map(|col| col.name_str().to_string()).collect())
                        .unwrap_or_default();

                    let mut row_buffer: Vec<Vec<String>> = Vec::with_capacity(max_insert_size);
                    let mut rows_in_batch = 0;

                    while let Some(row) = data_result.next().await.map_err(QueryError::for_query)? {
                        rows_in_batch += 1;
                        let mut values: Vec<String> = Vec::with_capacity(columns.len());
                        for i in 0..columns.len() {
                            let value: Value = row.get(i).unwrap_or(Value::NULL);
                            values.push(mysql_value_to_sql(value));
                        }
                        row_buffer.push(values);

                        if row_buffer.len() >= max_insert_size {
                            sql_content.push_str(&Self::format_insert_statement(
                                &table_name,
                                &columns,
                                &row_buffer,
                                data_mode,
                            ));
                            row_buffer.clear();
                        }
                    }

                    if !row_buffer.is_empty() {
                        sql_content.push_str(&Self::format_insert_statement(
                            &table_name,
                            &columns,
                            &row_buffer,
                            data_mode,
                        ));
                    }

                    if rows_in_batch < BATCH_SIZE {
                        break;
                    }

                    offset += BATCH_SIZE;
                }

                sql_content.push('\n');
            }
        }

        Ok(sql_content)
    }

    fn format_insert_statement(
        table_name: &str,
        columns: &[String],
        rows: &[Vec<String>],
        data_mode: &str,
    ) -> String {
        let statement_type = match data_mode {
            "replace" => "REPLACE",
            "insert_ignore" => "INSERT IGNORE",
            _ => "INSERT",
        };

        let column_list = columns
            .iter()
            .map(|c| format!("`{}`", escape_identifier(c)))
            .collect::<Vec<_>>()
            .join(", ");

        let values_list = rows
            .iter()
            .map(|row| format!("({})", row.join(", ")))
            .collect::<Vec<_>>()
            .join(",\n  ");

        format!(
            "{} INTO `{}` ({}) VALUES\n  {};\n",
            statement_type,
            escape_identifier(table_name),
            column_list,
            values_list
        )
    }
}
