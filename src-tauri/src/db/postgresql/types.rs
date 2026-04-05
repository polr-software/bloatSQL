use crate::db::connection::QueryError;
use tokio_postgres::{types::Type, Row};

/// Converts a tokio_postgres error to a QueryError with full details.
pub(super) fn pg_error_to_query_error(err: tokio_postgres::Error, code: &str) -> QueryError {
    if let Some(db_err) = err.as_db_error() {
        let mut query_err = QueryError::with_code(db_err.message().to_string(), code);

        query_err.code = Some(db_err.code().code().to_string());

        if let Some(detail) = db_err.detail() {
            query_err = query_err.with_detail(detail);
        }

        if let Some(hint) = db_err.hint() {
            query_err = query_err.with_hint(hint);
        }

        if query_err.hint.is_none() {
            let hint = match db_err.code().code() {
                "22P02" => Some("Value has invalid format for the target column type"),
                "22003" => Some("Value is out of range for the target column type"),
                "23502" => Some("Column does not allow NULL values"),
                "23503" => Some("Referenced value does not exist (foreign key violation)"),
                "23505" => Some("Value already exists (unique constraint violation)"),
                "42703" => Some("Check column name spelling"),
                "42P01" => Some("Check table name spelling"),
                _ => None,
            };
            if let Some(h) = hint {
                query_err = query_err.with_hint(h);
            }
        }

        query_err
    } else {
        QueryError::with_code(err.to_string(), code)
    }
}

#[inline]
pub(super) fn escape_identifier(name: &str) -> String {
    name.replace('"', "\"\"")
}

#[inline]
pub(super) fn escape_string(value: &str) -> String {
    value.replace('\'', "''").replace('\0', "")
}

#[inline]
pub(super) fn pg_value_to_json(row: &Row, idx: usize, col_type: &Type) -> serde_json::Value {
    match *col_type {
        Type::BOOL => row
            .try_get::<_, Option<bool>>(idx)
            .ok()
            .flatten()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),

        Type::INT2 => row
            .try_get::<_, Option<i16>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),

        Type::INT4 => row
            .try_get::<_, Option<i32>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),

        Type::INT8 => row
            .try_get::<_, Option<i64>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),

        Type::FLOAT4 => row
            .try_get::<_, Option<f32>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),

        Type::FLOAT8 => row
            .try_get::<_, Option<f64>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::json!(v))
            .unwrap_or(serde_json::Value::Null),

        Type::VARCHAR | Type::TEXT | Type::CHAR | Type::BPCHAR | Type::NAME => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),

        Type::BYTEA => row
            .try_get::<_, Option<Vec<u8>>>(idx)
            .ok()
            .flatten()
            .map(|v| {
                use base64::{engine::general_purpose, Engine as _};
                serde_json::Value::String(general_purpose::STANDARD.encode(&v))
            })
            .unwrap_or(serde_json::Value::Null),

        Type::TIMESTAMP => row
            .try_get::<_, Option<chrono::NaiveDateTime>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string()))
            .unwrap_or(serde_json::Value::Null),

        Type::TIMESTAMPTZ => row
            .try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::String(v.to_rfc3339()))
            .unwrap_or(serde_json::Value::Null),

        Type::DATE => row
            .try_get::<_, Option<chrono::NaiveDate>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::String(v.format("%Y-%m-%d").to_string()))
            .unwrap_or(serde_json::Value::Null),

        Type::TIME | Type::TIMETZ => row
            .try_get::<_, Option<chrono::NaiveTime>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::String(v.format("%H:%M:%S").to_string()))
            .unwrap_or(serde_json::Value::Null),

        Type::NUMERIC => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),

        Type::JSON | Type::JSONB => row
            .try_get::<_, Option<serde_json::Value>>(idx)
            .ok()
            .flatten()
            .unwrap_or(serde_json::Value::Null),

        Type::UUID => row
            .try_get::<_, Option<uuid::Uuid>>(idx)
            .ok()
            .flatten()
            .map(|v| serde_json::Value::String(v.to_string()))
            .unwrap_or(serde_json::Value::Null),

        _ => row
            .try_get::<_, Option<String>>(idx)
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}

#[cfg(test)]
mod tests {
    use super::escape_string;

    #[test]
    fn escape_string_keeps_backslashes_intact() {
        assert_eq!(escape_string(r"C:\temp\file.txt"), r"C:\temp\file.txt");
        assert_eq!(escape_string("it's fine"), "it''s fine");
        assert_eq!(escape_string("a\0b"), "ab");
    }
}
