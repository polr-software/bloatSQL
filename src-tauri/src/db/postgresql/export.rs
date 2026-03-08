use super::types::{escape_identifier, pg_value_to_sql};
use super::PostgresConnection;
use crate::db::connection::{DbResult, QueryError};

impl PostgresConnection {
    pub(super) async fn impl_export_database_with_options(
        &self,
        include_drop: bool,
        include_create: bool,
        data_mode: &str,
        selected_tables: &[String],
        max_insert_size: usize,
    ) -> DbResult<String> {
        let client = self.client.lock().await;
        let mut sql_content = String::with_capacity(1024 * 1024);

        let tables_to_export: Vec<String> = if selected_tables.is_empty() {
            let query = "SELECT table_name FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                         ORDER BY table_name";

            let rows = client
                .query(query, &[])
                .await
                .map_err(QueryError::for_query)?;

            rows.iter().filter_map(|row| row.try_get::<_, String>(0).ok()).collect()
        } else {
            selected_tables.to_vec()
        };

        for table_name in tables_to_export {
            sql_content.push_str(&format!("\n-- Table: {}\n", table_name));

            if include_drop {
                sql_content.push_str(&format!(
                    "DROP TABLE IF EXISTS \"{}\" CASCADE;\n",
                    escape_identifier(&table_name)
                ));
            }

            if include_create {
                let columns_query = "SELECT
                        column_name,
                        data_type,
                        character_maximum_length,
                        is_nullable,
                        column_default
                     FROM information_schema.columns
                     WHERE table_name = $1 AND table_schema = 'public'
                     ORDER BY ordinal_position";

                let col_rows = client
                    .query(columns_query, &[&table_name])
                    .await
                    .map_err(QueryError::for_query)?;

                sql_content.push_str(&format!(
                    "CREATE TABLE \"{}\" (\n",
                    escape_identifier(&table_name)
                ));

                let col_defs: Vec<String> = col_rows
                    .iter()
                    .filter_map(|row| {
                        let name = row.try_get::<_, String>(0).ok()?;
                        let data_type = row.try_get::<_, String>(1).ok()?;
                        let max_len = row.try_get::<_, Option<i32>>(2).ok()?;
                        let nullable = row.try_get::<_, String>(3).ok()?;
                        let default = row.try_get::<_, Option<String>>(4).ok()?;

                        let mut def = format!(
                            "  \"{}\" {}",
                            escape_identifier(&name),
                            data_type.to_uppercase()
                        );

                        if let Some(len) = max_len {
                            def.push_str(&format!("({})", len));
                        }
                        if nullable == "NO" {
                            def.push_str(" NOT NULL");
                        }
                        if let Some(default_val) = default {
                            def.push_str(&format!(" DEFAULT {}", default_val));
                        }

                        Some(def)
                    })
                    .collect();

                sql_content.push_str(&col_defs.join(",\n"));
                sql_content.push_str("\n);\n\n");
            }

            if data_mode != "no_data" {
                const BATCH_SIZE: i64 = 10000;
                let mut offset: i64 = 0;

                loop {
                    let data_query = format!(
                        "SELECT * FROM \"{}\" LIMIT {} OFFSET {}",
                        escape_identifier(&table_name),
                        BATCH_SIZE,
                        offset
                    );

                    let data_rows = client
                        .query(&data_query, &[])
                        .await
                        .map_err(QueryError::for_query)?;

                    if data_rows.is_empty() {
                        break;
                    }

                    let columns: Vec<String> = data_rows[0]
                        .columns()
                        .iter()
                        .map(|col| col.name().to_string())
                        .collect();

                    let mut row_buffer: Vec<Vec<String>> = Vec::with_capacity(max_insert_size);

                    for row in &data_rows {
                        let mut values: Vec<String> = Vec::with_capacity(columns.len());
                        for i in 0..columns.len() {
                            values.push(pg_value_to_sql(row, i, row.columns()[i].type_()));
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

                    if data_rows.len() < BATCH_SIZE as usize {
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
        let column_list = columns
            .iter()
            .map(|c| format!("\"{}\"", escape_identifier(c)))
            .collect::<Vec<_>>()
            .join(", ");

        let values_list = rows
            .iter()
            .map(|row| format!("({})", row.join(", ")))
            .collect::<Vec<_>>()
            .join(",\n  ");

        let conflict_clause = match data_mode {
            "replace" => format!(
                " ON CONFLICT DO UPDATE SET {}",
                columns
                    .iter()
                    .map(|c| format!(
                        "\"{}\" = EXCLUDED.\"{}\"",
                        escape_identifier(c),
                        escape_identifier(c)
                    ))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "insert_ignore" => " ON CONFLICT DO NOTHING".to_string(),
            _ => String::new(),
        };

        format!(
            "INSERT INTO \"{}\" ({}) VALUES\n  {}{};\n",
            escape_identifier(table_name),
            column_list,
            values_list,
            conflict_clause
        )
    }
}
