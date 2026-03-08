use mysql_async::Value;

pub(super) fn value_to_string(v: Value) -> String {
    match v {
        Value::Bytes(b) => String::from_utf8_lossy(&b).into_owned(),
        _ => String::new(),
    }
}

pub(super) fn value_to_option_string(v: Value) -> Option<String> {
    match v {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(&b).into_owned()),
        _ => None,
    }
}

pub(super) fn value_to_option_i64(v: Value) -> Option<i64> {
    match v {
        Value::NULL => None,
        Value::Int(i) => Some(i),
        Value::UInt(u) => Some(u as i64),
        _ => None,
    }
}

#[inline]
pub(super) fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

#[inline]
pub(super) fn escape_string(value: &str) -> String {
    value.replace('\'', "''").replace('\\', "\\\\")
}

#[inline]
pub(super) fn mysql_value_to_json(value: Value) -> serde_json::Value {
    match value {
        Value::NULL => serde_json::Value::Null,
        Value::Bytes(b) => serde_json::Value::String(String::from_utf8_lossy(&b).into_owned()),
        Value::Int(i) => serde_json::Value::Number(i.into()),
        Value::UInt(u) => serde_json::Value::Number(u.into()),
        Value::Float(f) => serde_json::Number::from_f64(f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Double(d) => serde_json::Number::from_f64(d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Date(y, m, d, h, min, s, _) => serde_json::Value::String(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            y, m, d, h, min, s
        )),
        Value::Time(_, h, m, s, _, _) => {
            serde_json::Value::String(format!("{:02}:{:02}:{:02}", h, m, s))
        }
    }
}

#[inline]
pub(super) fn mysql_value_to_sql(value: Value) -> String {
    match value {
        Value::NULL => "NULL".to_string(),
        Value::Bytes(b) => {
            let s = String::from_utf8_lossy(&b);
            format!("'{}'", escape_string(&s))
        }
        Value::Int(i) => i.to_string(),
        Value::UInt(u) => u.to_string(),
        Value::Float(f) => f.to_string(),
        Value::Double(d) => d.to_string(),
        Value::Date(y, m, d, h, min, s, _) => {
            format!("'{:04}-{:02}-{:02} {:02}:{:02}:{:02}'", y, m, d, h, min, s)
        }
        Value::Time(_, h, m, s, _, _) => format!("'{:02}:{:02}:{:02}'", h, m, s),
    }
}
