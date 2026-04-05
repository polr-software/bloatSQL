use super::catalog::PostgresCatalog;
use super::model::{PgColumnDefinition, PgConstraintDefinition, PgEnumDefinition};
use super::types::{escape_identifier, escape_string};
use super::PostgresConnection;
use crate::db::connection::{error_codes, DbResult, QueryError};
use std::collections::{HashMap, HashSet, VecDeque};
use tokio_postgres::Client;
use tracing::warn;

pub(super) struct ExportOptions<'a> {
    pub include_drop: bool,
    pub include_create: bool,
    pub data_mode: &'a str,
    pub selected_tables: &'a [String],
    pub max_insert_size: usize,
}

#[derive(Debug, Clone)]
struct TableExportPlan {
    table_name: String,
    columns: Vec<PgColumnDefinition>,
    insert_columns: Vec<PgColumnDefinition>,
    insert_column_names: Vec<String>,
    primary_keys: Vec<String>,
}

impl TableExportPlan {
    fn new(table_name: &str, columns: Vec<PgColumnDefinition>, primary_keys: Vec<String>) -> Self {
        let insert_columns = columns
            .iter()
            .filter(|column| column.is_insertable())
            .cloned()
            .collect::<Vec<_>>();
        let insert_column_names = insert_columns
            .iter()
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();

        Self {
            table_name: table_name.to_string(),
            columns,
            insert_columns,
            insert_column_names,
            primary_keys,
        }
    }

    fn requires_system_override(&self) -> bool {
        self.insert_columns
            .iter()
            .any(PgColumnDefinition::requires_system_override)
    }

    fn sequence_reset_statements(&self) -> Vec<String> {
        self.insert_columns
            .iter()
            .filter_map(|column| build_sequence_reset_statement(&self.table_name, column))
            .collect()
    }
}

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

        export_database(
            &client,
            ExportOptions {
                include_drop,
                include_create,
                data_mode,
                selected_tables,
                max_insert_size,
            },
        )
        .await
    }
}

pub(super) async fn export_database(
    client: &Client,
    options: ExportOptions<'_>,
) -> DbResult<String> {
    client
        .batch_execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;")
        .await
        .map_err(|error| {
            QueryError::with_code(
                format!("Failed to start export snapshot: {}", error),
                error_codes::QUERY_ERROR,
            )
        })?;

    let export_result = export_database_inner(client, options).await;
    let rollback_result = client.batch_execute("ROLLBACK;").await.map_err(|error| {
        QueryError::with_code(
            format!("Failed to close export snapshot: {}", error),
            error_codes::QUERY_ERROR,
        )
    });

    match (export_result, rollback_result) {
        (Ok(sql_content), Ok(())) => Ok(sql_content),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Err(primary_error), Err(rollback_error)) => {
            warn!(
                "Export rollback failed after primary error: {}",
                rollback_error.message
            );
            Err(primary_error)
        }
    }
}

async fn export_database_inner(client: &Client, options: ExportOptions<'_>) -> DbResult<String> {
    let catalog = PostgresCatalog::new(client);
    let mut sql_content = String::with_capacity(1024 * 1024);
    let flush_size = options.max_insert_size.max(1);

    let all_tables = catalog.load_table_names(options.selected_tables).await?;
    let table_primary_keys = catalog.load_primary_keys().await?;
    let constraint_definitions = catalog.load_constraint_definitions().await?;
    let table_indexes = if options.include_create {
        catalog.load_index_definitions().await?
    } else {
        HashMap::new()
    };

    let fk_dependencies = constraint_definitions
        .values()
        .flat_map(|constraints| constraints.iter())
        .filter(|constraint| constraint.constraint_type == 'f')
        .filter_map(|constraint| {
            constraint
                .referenced_table
                .as_ref()
                .map(|referenced_table| (constraint.table_name.clone(), referenced_table.clone()))
        })
        .collect::<Vec<_>>();

    let tables_to_export = topological_sort(&all_tables, &fk_dependencies);
    let export_set: HashSet<String> = tables_to_export.iter().cloned().collect();
    let enum_definitions = if options.include_create {
        catalog.load_enum_definitions(&export_set).await?
    } else {
        Vec::new()
    };

    sql_content.push_str("BEGIN;\n");

    if options.include_drop {
        append_drop_statements(&mut sql_content, &tables_to_export, &enum_definitions);
    }

    if options.include_create {
        append_enum_definitions(&mut sql_content, &enum_definitions);
    }

    let mut deferred_foreign_keys = Vec::new();
    let mut sequence_reset_statements = Vec::new();

    for table_name in &tables_to_export {
        sql_content.push_str(&format!("\n-- Table: {}\n", table_name));

        let columns = if options.include_create || options.data_mode != "no_data" {
            catalog.load_column_definitions(table_name).await?
        } else {
            Vec::new()
        };
        let primary_keys = table_primary_keys
            .get(table_name)
            .cloned()
            .unwrap_or_default();
        let plan = TableExportPlan::new(table_name, columns, primary_keys);

        if options.include_create {
            append_table_schema(
                &mut sql_content,
                &plan,
                constraint_definitions.get(table_name),
                table_indexes.get(table_name),
                &export_set,
                &mut deferred_foreign_keys,
            );
        }

        if options.data_mode != "no_data" {
            if options.data_mode == "replace"
                && !plan.insert_column_names.is_empty()
                && plan.primary_keys.is_empty()
            {
                return Err(QueryError::with_code(
                    format!(
                        "Cannot export table '{}' in replace mode because it has no primary key",
                        table_name
                    ),
                    error_codes::QUERY_ERROR,
                )
                .with_hint("Use insert or insert_ignore, or add a primary key to the table."));
            }

            append_table_data(
                &mut sql_content,
                client,
                &plan,
                options.data_mode,
                flush_size,
            )
            .await?;
            sequence_reset_statements.extend(plan.sequence_reset_statements());
            sql_content.push('\n');
        }
    }

    if !sequence_reset_statements.is_empty() {
        sql_content.push_str("\n-- Sequence Resets\n");
        for statement in &sequence_reset_statements {
            sql_content.push_str(statement);
        }
    }

    if options.include_create && !deferred_foreign_keys.is_empty() {
        sql_content.push_str("\n-- Foreign Key Constraints\n");
        for constraint in &deferred_foreign_keys {
            sql_content.push_str(&format!(
                "ALTER TABLE \"{}\" ADD CONSTRAINT \"{}\" {};\n",
                escape_identifier(&constraint.table_name),
                escape_identifier(&constraint.constraint_name),
                constraint.definition
            ));
        }
    }

    sql_content.push_str("\nCOMMIT;\n");
    Ok(sql_content)
}

fn append_drop_statements(
    sql_content: &mut String,
    tables_to_export: &[String],
    enum_definitions: &[PgEnumDefinition],
) {
    for table_name in tables_to_export {
        sql_content.push_str(&format!(
            "DROP TABLE IF EXISTS \"{}\" CASCADE;\n",
            escape_identifier(table_name)
        ));
    }

    for enum_definition in enum_definitions {
        sql_content.push_str(&format!(
            "DROP TYPE IF EXISTS \"{}\";\n",
            escape_identifier(&enum_definition.type_name)
        ));
    }

    sql_content.push('\n');
}

fn append_enum_definitions(sql_content: &mut String, enum_definitions: &[PgEnumDefinition]) {
    for enum_definition in enum_definitions {
        let labels = enum_definition
            .labels
            .iter()
            .map(|label| format!("'{}'", escape_string(label)))
            .collect::<Vec<_>>()
            .join(", ");

        sql_content.push_str(&format!(
            "CREATE TYPE \"{}\" AS ENUM ({});\n\n",
            escape_identifier(&enum_definition.type_name),
            labels
        ));
    }
}

fn append_table_schema(
    sql_content: &mut String,
    plan: &TableExportPlan,
    constraints: Option<&Vec<PgConstraintDefinition>>,
    indexes: Option<&Vec<String>>,
    export_set: &HashSet<String>,
    deferred_foreign_keys: &mut Vec<PgConstraintDefinition>,
) {
    let column_definitions = plan
        .columns
        .iter()
        .map(format_column_definition)
        .collect::<Vec<_>>()
        .join(",\n");

    sql_content.push_str(&format!(
        "CREATE TABLE \"{}\" (\n{}\n);\n",
        escape_identifier(&plan.table_name),
        column_definitions
    ));

    if let Some(constraints) = constraints {
        for constraint in constraints {
            if constraint.constraint_type == 'f' {
                let should_export_fk = constraint
                    .referenced_table
                    .as_ref()
                    .map(|referenced_table| export_set.contains(referenced_table))
                    .unwrap_or(false);

                if should_export_fk {
                    deferred_foreign_keys.push(constraint.clone());
                } else if let Some(referenced_table) = &constraint.referenced_table {
                    warn!(
                        "Skipping foreign key '{}' on table '{}' because referenced table '{}' is outside the export set",
                        constraint.constraint_name,
                        plan.table_name,
                        referenced_table
                    );
                }

                continue;
            }

            sql_content.push_str(&format!(
                "ALTER TABLE \"{}\" ADD CONSTRAINT \"{}\" {};\n",
                escape_identifier(&plan.table_name),
                escape_identifier(&constraint.constraint_name),
                constraint.definition
            ));
        }
    }

    if let Some(indexes) = indexes {
        for index_definition in indexes {
            sql_content.push_str(index_definition);
            sql_content.push_str(";\n");
        }
    }

    sql_content.push('\n');
}

async fn append_table_data(
    sql_content: &mut String,
    client: &Client,
    plan: &TableExportPlan,
    data_mode: &str,
    max_insert_size: usize,
) -> DbResult<()> {
    const BATCH_SIZE: i64 = 10_000;
    let mut offset = 0;

    if plan.insert_column_names.is_empty() {
        loop {
            let data_query = build_zero_column_data_query(
                &plan.table_name,
                &plan.primary_keys,
                BATCH_SIZE,
                offset,
            );
            let data_rows = client.query(&data_query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

            if data_rows.is_empty() {
                break;
            }

            sql_content.push_str(&format_default_values_statements(
                &plan.table_name,
                data_rows.len(),
            ));

            if data_rows.len() < BATCH_SIZE as usize {
                break;
            }

            offset += BATCH_SIZE;
        }

        return Ok(());
    }

    loop {
        let data_query = build_table_data_query(plan, BATCH_SIZE, offset);
        let data_rows = client
            .query(&data_query, &[])
            .await
            .map_err(|error| QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR))?;

        if data_rows.is_empty() {
            break;
        }

        let mut row_buffer = Vec::with_capacity(max_insert_size);

        for row in &data_rows {
            let mut values = Vec::with_capacity(plan.insert_column_names.len());

            for index in 0..plan.insert_column_names.len() {
                let value = row
                    .try_get::<_, Option<String>>(index)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "NULL".to_string());
                values.push(value);
            }

            row_buffer.push(values);

            if row_buffer.len() >= max_insert_size {
                sql_content.push_str(&format_insert_statement(plan, &row_buffer, data_mode)?);
                row_buffer.clear();
            }
        }

        if !row_buffer.is_empty() {
            sql_content.push_str(&format_insert_statement(plan, &row_buffer, data_mode)?);
        }

        if data_rows.len() < BATCH_SIZE as usize {
            break;
        }

        offset += BATCH_SIZE;
    }

    Ok(())
}

fn topological_sort(tables: &[String], dependencies: &[(String, String)]) -> Vec<String> {
    let table_set: HashSet<&str> = tables.iter().map(String::as_str).collect();
    let mut in_degree = HashMap::new();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();

    for table in &table_set {
        in_degree.insert(*table, 0usize);
    }

    for (from_table, to_table) in dependencies {
        if table_set.contains(from_table.as_str())
            && table_set.contains(to_table.as_str())
            && from_table != to_table
        {
            dependents
                .entry(to_table.as_str())
                .or_default()
                .push(from_table.as_str());
            *in_degree.entry(from_table.as_str()).or_insert(0) += 1;
        }
    }

    let mut ready = in_degree
        .iter()
        .filter_map(|(table, degree)| (*degree == 0).then_some(*table))
        .collect::<Vec<_>>();
    ready.sort_unstable();

    let mut queue: VecDeque<&str> = ready.into_iter().collect();
    let mut result = Vec::with_capacity(tables.len());
    let mut seen = HashSet::new();

    while let Some(table) = queue.pop_front() {
        if !seen.insert(table) {
            continue;
        }

        result.push(table.to_string());

        if let Some(table_dependents) = dependents.get(table) {
            let mut next_tables = Vec::new();
            for dependent in table_dependents {
                if let Some(degree) = in_degree.get_mut(dependent) {
                    *degree -= 1;
                    if *degree == 0 {
                        next_tables.push(*dependent);
                    }
                }
            }
            next_tables.sort_unstable();
            for next_table in next_tables {
                queue.push_back(next_table);
            }
        }
    }

    for table in tables {
        if seen.insert(table.as_str()) {
            warn!(
                "Circular FK dependency detected for table '{}', appending at end",
                table
            );
            result.push(table.clone());
        }
    }

    result
}

fn format_column_definition(column: &PgColumnDefinition) -> String {
    let mut definition = format!(
        "  \"{}\" {}",
        escape_identifier(&column.name),
        column.sql_type
    );

    if let Some(identity_kind) = column.identity_kind {
        match identity_kind {
            'a' => definition.push_str(" GENERATED ALWAYS AS IDENTITY"),
            'd' => definition.push_str(" GENERATED BY DEFAULT AS IDENTITY"),
            _ => {}
        }
    } else if let Some(generated_expr) = &column.generated_expr {
        definition.push_str(&format!(" GENERATED ALWAYS AS ({}) STORED", generated_expr));
    } else if let Some(default_expr) = &column.default_expr {
        definition.push_str(&format!(" DEFAULT {}", default_expr));
    }

    if column.is_not_null {
        definition.push_str(" NOT NULL");
    }

    definition
}

fn build_table_data_query(plan: &TableExportPlan, batch_size: i64, offset: i64) -> String {
    let projection = plan
        .insert_columns
        .iter()
        .map(|column| {
            let escaped_name = escape_identifier(&column.name);
            format!(
                "quote_nullable(\"{name}\"::text) AS \"{name}\"",
                name = escaped_name
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "SELECT {} FROM \"{}\"{} LIMIT {} OFFSET {}",
        projection,
        escape_identifier(&plan.table_name),
        build_order_by_clause(&plan.primary_keys),
        batch_size,
        offset
    )
}

fn build_zero_column_data_query(
    table_name: &str,
    primary_keys: &[String],
    batch_size: i64,
    offset: i64,
) -> String {
    format!(
        "SELECT 1 FROM \"{}\"{} LIMIT {} OFFSET {}",
        escape_identifier(table_name),
        build_order_by_clause(primary_keys),
        batch_size,
        offset
    )
}

fn build_order_by_clause(primary_keys: &[String]) -> String {
    if primary_keys.is_empty() {
        " ORDER BY ctid".to_string()
    } else {
        let primary_key_list = primary_keys
            .iter()
            .map(|column| format!("\"{}\"", escape_identifier(column)))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" ORDER BY {}, ctid", primary_key_list)
    }
}

fn format_insert_statement(
    plan: &TableExportPlan,
    rows: &[Vec<String>],
    data_mode: &str,
) -> DbResult<String> {
    let column_list = plan
        .insert_column_names
        .iter()
        .map(|column| format!("\"{}\"", escape_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");

    let values_list = rows
        .iter()
        .map(|row| format!("({})", row.join(", ")))
        .collect::<Vec<_>>()
        .join(",\n  ");

    let overriding_clause = if plan.requires_system_override() {
        " OVERRIDING SYSTEM VALUE"
    } else {
        ""
    };

    let conflict_clause = match data_mode {
        "replace" => build_replace_conflict_clause(&plan.primary_keys, &plan.insert_column_names)?,
        "insert_ignore" => " ON CONFLICT DO NOTHING".to_string(),
        _ => String::new(),
    };

    Ok(format!(
        "INSERT INTO \"{}\" ({}){} VALUES\n  {}{};\n",
        escape_identifier(&plan.table_name),
        column_list,
        overriding_clause,
        values_list,
        conflict_clause
    ))
}

fn build_replace_conflict_clause(
    primary_keys: &[String],
    insert_columns: &[String],
) -> DbResult<String> {
    if primary_keys.is_empty() {
        return Err(QueryError::with_code(
            "Replace mode requires a primary key to build a deterministic ON CONFLICT clause",
            error_codes::QUERY_ERROR,
        ));
    }

    let primary_key_set: HashSet<&str> = primary_keys.iter().map(String::as_str).collect();
    let primary_key_list = primary_keys
        .iter()
        .map(|column| format!("\"{}\"", escape_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");

    let update_set = insert_columns
        .iter()
        .filter(|column| !primary_key_set.contains(column.as_str()))
        .map(|column| format!("\"{0}\" = EXCLUDED.\"{0}\"", escape_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");

    if update_set.is_empty() {
        Ok(format!(" ON CONFLICT ({}) DO NOTHING", primary_key_list))
    } else {
        Ok(format!(
            " ON CONFLICT ({}) DO UPDATE SET {}",
            primary_key_list, update_set
        ))
    }
}

fn format_default_values_statements(table_name: &str, row_count: usize) -> String {
    let statement = format!(
        "INSERT INTO \"{}\" DEFAULT VALUES;\n",
        escape_identifier(table_name)
    );
    statement.repeat(row_count)
}

fn build_sequence_reset_statement(table_name: &str, column: &PgColumnDefinition) -> Option<String> {
    let sequence_name = column.sequence_name.as_ref()?;
    let sequence_start = column.sequence_start.unwrap_or(1);
    let escaped_table_name = escape_identifier(table_name);
    let escaped_column_name = escape_identifier(&column.name);

    Some(format!(
        "SELECT CASE\n  WHEN MAX(\"{column}\") IS NULL THEN pg_catalog.setval('{sequence}', {start_value}, false)\n  ELSE pg_catalog.setval('{sequence}', GREATEST(MAX(\"{column}\"), {start_value}), true)\nEND FROM \"{table}\";\n",
        column = escaped_column_name,
        sequence = escape_string(sequence_name),
        start_value = sequence_start,
        table = escaped_table_name
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        build_order_by_clause, build_sequence_reset_statement, format_column_definition,
        format_insert_statement, topological_sort, TableExportPlan,
    };
    use crate::db::postgresql::model::PgColumnDefinition;

    fn plain_column(name: &str, sql_type: &str) -> PgColumnDefinition {
        PgColumnDefinition {
            name: name.to_string(),
            sql_type: sql_type.to_string(),
            default_expr: None,
            is_not_null: false,
            identity_kind: None,
            generated_expr: None,
            sequence_name: None,
            sequence_start: None,
        }
    }

    #[test]
    fn topological_sort_places_dependencies_first() {
        let tables = vec![
            "orders".to_string(),
            "users".to_string(),
            "order_items".to_string(),
        ];
        let dependencies = vec![
            ("orders".to_string(), "users".to_string()),
            ("order_items".to_string(), "orders".to_string()),
        ];

        assert_eq!(
            topological_sort(&tables, &dependencies),
            vec![
                "users".to_string(),
                "orders".to_string(),
                "order_items".to_string(),
            ]
        );
    }

    #[test]
    fn format_insert_statement_uses_primary_key_target() {
        let plan = TableExportPlan::new(
            "users",
            vec![plain_column("id", "integer"), plain_column("name", "text")],
            vec!["id".to_string()],
        );

        let statement = format_insert_statement(
            &plan,
            &[vec!["1".to_string(), "'Alice'".to_string()]],
            "replace",
        )
        .expect("statement should render");

        assert!(
            statement.contains("ON CONFLICT (\"id\") DO UPDATE SET \"name\" = EXCLUDED.\"name\"")
        );
        assert!(!statement.contains("\"id\" = EXCLUDED.\"id\""));
    }

    #[test]
    fn format_insert_statement_adds_overriding_system_value_for_identity_always() {
        let mut id_column = plain_column("id", "integer");
        id_column.identity_kind = Some('a');

        let plan = TableExportPlan::new(
            "users",
            vec![id_column, plain_column("name", "text")],
            vec!["id".to_string()],
        );

        let statement = format_insert_statement(
            &plan,
            &[vec!["1".to_string(), "'Alice'".to_string()]],
            "insert",
        )
        .expect("statement should render");

        assert!(statement
            .contains("INSERT INTO \"users\" (\"id\", \"name\") OVERRIDING SYSTEM VALUE VALUES"));
    }

    #[test]
    fn table_export_plan_skips_generated_columns_from_insert_list() {
        let mut generated_column = plain_column("full_name", "text");
        generated_column.generated_expr = Some("first_name || ' ' || last_name".to_string());

        let plan = TableExportPlan::new(
            "users",
            vec![
                plain_column("id", "integer"),
                plain_column("first_name", "text"),
                generated_column,
            ],
            vec!["id".to_string()],
        );

        assert_eq!(
            plan.insert_column_names,
            vec!["id".to_string(), "first_name".to_string()]
        );
    }

    #[test]
    fn build_sequence_reset_statement_preserves_sequence_start_value() {
        let mut id_column = plain_column("id", "integer");
        id_column.sequence_name = Some("public.users_id_seq".to_string());
        id_column.sequence_start = Some(42);

        let statement =
            build_sequence_reset_statement("users", &id_column).expect("statement should exist");

        assert!(statement.contains("setval('public.users_id_seq', 42, false)"));
        assert!(statement.contains("GREATEST(MAX(\"id\"), 42)"));
    }

    #[test]
    fn build_order_by_clause_falls_back_to_ctid_without_primary_key() {
        assert_eq!(build_order_by_clause(&[]), " ORDER BY ctid");
        assert_eq!(
            build_order_by_clause(&["id".to_string()]),
            " ORDER BY \"id\", ctid"
        );
    }

    #[test]
    fn format_column_definition_handles_identity_and_generated_columns() {
        let mut identity = plain_column("id", "integer");
        identity.is_not_null = true;
        identity.identity_kind = Some('a');
        identity.default_expr = Some("nextval('users_id_seq'::regclass)".to_string());
        assert_eq!(
            format_column_definition(&identity),
            "  \"id\" integer GENERATED ALWAYS AS IDENTITY NOT NULL"
        );

        let mut generated = plain_column("full_name", "text");
        generated.generated_expr = Some("first_name || ' ' || last_name".to_string());
        assert_eq!(
            format_column_definition(&generated),
            "  \"full_name\" text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED"
        );
    }
}
