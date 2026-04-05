use super::model::{PgColumnDefinition, PgConstraintDefinition, PgEnumDefinition};
use crate::db::connection::{error_codes, DbResult, QueryError, TableColumn, TableRelationship};
use std::collections::{HashMap, HashSet};
use tokio_postgres::Client;

pub(super) struct PostgresCatalog<'a> {
    client: &'a Client,
}

impl<'a> PostgresCatalog<'a> {
    pub(super) fn new(client: &'a Client) -> Self {
        Self { client }
    }

    pub(super) async fn load_public_table_names(&self) -> DbResult<Vec<String>> {
        let query = "SELECT table_name FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                     ORDER BY table_name";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        Ok(rows
            .iter()
            .filter_map(|row| row.try_get::<_, String>(0).ok())
            .collect())
    }

    pub(super) async fn load_table_names(
        &self,
        selected_tables: &[String],
    ) -> DbResult<Vec<String>> {
        let existing_tables = self.load_public_table_names().await?;
        if selected_tables.is_empty() {
            return Ok(existing_tables);
        }

        let existing_set: HashSet<&str> = existing_tables.iter().map(String::as_str).collect();
        let missing_tables = selected_tables
            .iter()
            .filter(|table_name| !existing_set.contains(table_name.as_str()))
            .cloned()
            .collect::<Vec<_>>();

        if !missing_tables.is_empty() {
            return Err(QueryError::with_code(
                format!(
                    "Selected tables not found in public schema: {}",
                    missing_tables.join(", ")
                ),
                error_codes::QUERY_ERROR,
            ));
        }

        Ok(selected_tables.to_vec())
    }

    pub(super) async fn load_database_names(&self) -> DbResult<Vec<String>> {
        let query = "SELECT datname FROM pg_database
                     WHERE datistemplate = false
                     ORDER BY datname";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        Ok(rows
            .iter()
            .filter_map(|row| row.try_get::<_, String>(0).ok())
            .collect())
    }

    pub(super) async fn load_primary_keys(&self) -> DbResult<HashMap<String, Vec<String>>> {
        let query = "SELECT
                tc.table_name,
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = 'public'
            ORDER BY tc.table_name, kcu.ordinal_position";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        let mut primary_keys = HashMap::new();
        for row in &rows {
            if let (Ok(table_name), Ok(column_name)) =
                (row.try_get::<_, String>(0), row.try_get::<_, String>(1))
            {
                primary_keys
                    .entry(table_name)
                    .or_insert_with(Vec::new)
                    .push(column_name);
            }
        }

        Ok(primary_keys)
    }

    pub(super) async fn load_constraint_definitions(
        &self,
    ) -> DbResult<HashMap<String, Vec<PgConstraintDefinition>>> {
        let query = "SELECT
                rel.relname AS table_name,
                con.conname AS constraint_name,
                con.contype::text AS constraint_type,
                pg_get_constraintdef(con.oid, true) AS definition,
                ref.relname AS referenced_table
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            LEFT JOIN pg_class ref ON ref.oid = con.confrelid
            WHERE nsp.nspname = 'public'
                AND con.contype IN ('p', 'u', 'f', 'c')
            ORDER BY
                rel.relname,
                CASE con.contype
                    WHEN 'p' THEN 0
                    WHEN 'u' THEN 1
                    WHEN 'c' THEN 2
                    WHEN 'f' THEN 3
                    ELSE 4
                END,
                con.conname";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        let mut constraints = HashMap::new();
        for row in &rows {
            let constraint_type = row
                .try_get::<_, String>(2)
                .ok()
                .and_then(|value| value.chars().next());

            if let (Ok(table_name), Ok(constraint_name), Some(constraint_type), Ok(definition)) = (
                row.try_get::<_, String>(0),
                row.try_get::<_, String>(1),
                constraint_type,
                row.try_get::<_, String>(3),
            ) {
                constraints
                    .entry(table_name.clone())
                    .or_insert_with(Vec::new)
                    .push(PgConstraintDefinition {
                        table_name,
                        constraint_name,
                        constraint_type,
                        definition,
                        referenced_table: row.try_get::<_, Option<String>>(4).ok().flatten(),
                    });
            }
        }

        Ok(constraints)
    }

    pub(super) async fn load_index_definitions(&self) -> DbResult<HashMap<String, Vec<String>>> {
        let query = "SELECT
                tbl.relname AS table_name,
                pg_get_indexdef(idx.indexrelid, 0, true) AS index_definition
            FROM pg_index idx
            JOIN pg_class tbl ON tbl.oid = idx.indrelid
            JOIN pg_namespace nsp ON nsp.oid = tbl.relnamespace
            LEFT JOIN pg_constraint con ON con.conindid = idx.indexrelid
            WHERE nsp.nspname = 'public'
                AND tbl.relkind = 'r'
                AND con.oid IS NULL
            ORDER BY tbl.relname, idx.indexrelid";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        let mut indexes = HashMap::new();
        for row in &rows {
            if let (Ok(table_name), Ok(index_definition)) =
                (row.try_get::<_, String>(0), row.try_get::<_, String>(1))
            {
                indexes
                    .entry(table_name)
                    .or_insert_with(Vec::new)
                    .push(index_definition);
            }
        }

        Ok(indexes)
    }

    pub(super) async fn load_column_definitions(
        &self,
        table_name: &str,
    ) -> DbResult<Vec<PgColumnDefinition>> {
        let query = "SELECT
                a.attname,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_sql,
                a.attnotnull,
                pg_get_expr(ad.adbin, ad.adrelid) AS expression_sql,
                a.attidentity::text,
                a.attgenerated::text,
                CASE
                    WHEN seq_cls.oid IS NOT NULL THEN format('%I.%I', seq_nsp.nspname, seq_cls.relname)
                    ELSE NULL
                END AS sequence_name,
                seq.seqstart
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            LEFT JOIN pg_depend seq_dep
                ON seq_dep.refclassid = 'pg_class'::regclass
                AND seq_dep.refobjid = c.oid
                AND seq_dep.refobjsubid = a.attnum
                AND seq_dep.classid = 'pg_class'::regclass
                AND seq_dep.deptype IN ('a', 'i')
            LEFT JOIN pg_class seq_cls ON seq_cls.oid = seq_dep.objid AND seq_cls.relkind = 'S'
            LEFT JOIN pg_namespace seq_nsp ON seq_nsp.oid = seq_cls.relnamespace
            LEFT JOIN pg_sequence seq ON seq.seqrelid = seq_cls.oid
            WHERE c.relname = $1
                AND nsp.nspname = 'public'
                AND a.attnum > 0
                AND NOT a.attisdropped
            ORDER BY a.attnum";

        let rows = self
            .client
            .query(query, &[&table_name])
            .await
            .map_err(|error| QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR))?;

        Ok(rows
            .iter()
            .filter_map(|row| {
                let expression_sql = row.try_get::<_, Option<String>>(3).ok()?;
                let identity_kind = row
                    .try_get::<_, String>(4)
                    .ok()
                    .filter(|value| !value.is_empty())
                    .and_then(|value| value.chars().next());
                let is_generated = row
                    .try_get::<_, String>(5)
                    .ok()
                    .map(|value| value == "s")
                    .unwrap_or(false);

                Some(PgColumnDefinition {
                    name: row.try_get::<_, String>(0).ok()?,
                    sql_type: row.try_get::<_, String>(1).ok()?,
                    is_not_null: row.try_get::<_, bool>(2).ok()?,
                    default_expr: if is_generated {
                        None
                    } else {
                        expression_sql.clone()
                    },
                    identity_kind,
                    generated_expr: if is_generated { expression_sql } else { None },
                    sequence_name: row.try_get::<_, Option<String>>(6).ok().flatten(),
                    sequence_start: row.try_get::<_, Option<i64>>(7).ok().flatten(),
                })
            })
            .collect())
    }

    pub(super) async fn load_enum_definitions(
        &self,
        export_tables: &HashSet<String>,
    ) -> DbResult<Vec<PgEnumDefinition>> {
        let query = "SELECT
                rel.relname AS table_name,
                enum_t.oid AS type_oid,
                enum_t.typname AS type_name,
                enum_label.enumlabel
            FROM pg_attribute a
            JOIN pg_class rel ON rel.oid = a.attrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            JOIN pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_type elem_t ON elem_t.oid = t.typelem
            JOIN pg_type enum_t ON enum_t.oid = CASE
                WHEN t.typtype = 'e' THEN t.oid
                WHEN t.typelem <> 0 AND elem_t.typtype = 'e' THEN elem_t.oid
                ELSE NULL
            END
            JOIN pg_enum enum_label ON enum_label.enumtypid = enum_t.oid
            WHERE nsp.nspname = 'public'
                AND a.attnum > 0
                AND NOT a.attisdropped
            ORDER BY enum_t.oid, enum_label.enumsortorder, rel.relname";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        let mut enum_map = HashMap::new();
        for row in &rows {
            if let (Ok(table_name), Ok(type_oid), Ok(type_name), Ok(label)) = (
                row.try_get::<_, String>(0),
                row.try_get::<_, u32>(1),
                row.try_get::<_, String>(2),
                row.try_get::<_, String>(3),
            ) {
                if export_tables.contains(&table_name) {
                    merge_enum_label(&mut enum_map, type_oid, type_name, label);
                }
            }
        }

        let mut enums = enum_map.into_values().collect::<Vec<_>>();
        enums.sort_by(|left, right| left.type_name.cmp(&right.type_name));
        Ok(enums)
    }

    pub(super) async fn load_table_columns(&self, table_name: &str) -> DbResult<Vec<TableColumn>> {
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

        let rows = self
            .client
            .query(query, &[&table_name])
            .await
            .map_err(|error| QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR))?;

        Ok(rows
            .iter()
            .filter_map(|row| {
                Some(TableColumn {
                    name: row.try_get::<_, String>(0).ok()?,
                    data_type: row.try_get::<_, String>(1).ok()?,
                    is_nullable: row.try_get::<_, String>(2).ok()? == "YES",
                    is_primary_key: row.try_get::<_, bool>(3).ok()?,
                    column_default: row.try_get::<_, String>(4).ok(),
                    character_maximum_length: row.try_get::<_, i32>(5).ok().map(i64::from),
                    numeric_precision: row.try_get::<_, i32>(6).ok().map(i64::from),
                })
            })
            .collect())
    }

    pub(super) async fn load_table_relationships(&self) -> DbResult<Vec<TableRelationship>> {
        let query = "SELECT
                        src.relname AS from_table,
                        src_att.attname AS from_column,
                        ref.relname AS to_table,
                        ref_att.attname AS to_column,
                        con.conname AS constraint_name
                     FROM pg_constraint con
                     JOIN pg_class src ON src.oid = con.conrelid
                     JOIN pg_namespace src_nsp ON src_nsp.oid = src.relnamespace
                     JOIN pg_class ref ON ref.oid = con.confrelid
                     JOIN unnest(con.conkey) WITH ORDINALITY AS src_key(attnum, ord)
                        ON TRUE
                     JOIN unnest(con.confkey) WITH ORDINALITY AS ref_key(attnum, ord)
                        ON ref_key.ord = src_key.ord
                     JOIN pg_attribute src_att
                        ON src_att.attrelid = con.conrelid
                        AND src_att.attnum = src_key.attnum
                     JOIN pg_attribute ref_att
                        ON ref_att.attrelid = con.confrelid
                        AND ref_att.attnum = ref_key.attnum
                     WHERE con.contype = 'f'
                        AND src_nsp.nspname = 'public'
                     ORDER BY src.relname, con.conname, src_key.ord";

        let rows =
            self.client.query(query, &[]).await.map_err(|error| {
                QueryError::with_code(error.to_string(), error_codes::QUERY_ERROR)
            })?;

        Ok(rows
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
            .collect())
    }
}

fn merge_enum_label(
    enum_map: &mut HashMap<u32, PgEnumDefinition>,
    type_oid: u32,
    type_name: String,
    label: String,
) {
    let entry = enum_map
        .entry(type_oid)
        .or_insert_with(|| PgEnumDefinition {
            type_name,
            labels: Vec::new(),
        });

    if !entry.labels.contains(&label) {
        entry.labels.push(label);
    }
}

#[cfg(test)]
mod tests {
    use super::merge_enum_label;
    use crate::db::postgresql::model::PgEnumDefinition;
    use std::collections::HashMap;

    #[test]
    fn merge_enum_label_deduplicates_shared_enum_values() {
        let mut enum_map: HashMap<u32, PgEnumDefinition> = HashMap::new();

        merge_enum_label(&mut enum_map, 10, "status".to_string(), "draft".to_string());
        merge_enum_label(
            &mut enum_map,
            10,
            "status".to_string(),
            "published".to_string(),
        );
        merge_enum_label(&mut enum_map, 10, "status".to_string(), "draft".to_string());

        assert_eq!(
            enum_map
                .get(&10)
                .map(|definition| definition.labels.clone()),
            Some(vec!["draft".to_string(), "published".to_string()])
        );
    }
}
