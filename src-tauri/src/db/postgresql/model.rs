#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PgColumnDefinition {
    pub name: String,
    pub sql_type: String,
    pub default_expr: Option<String>,
    pub is_not_null: bool,
    pub identity_kind: Option<char>,
    pub generated_expr: Option<String>,
    pub sequence_name: Option<String>,
    pub sequence_start: Option<i64>,
}

impl PgColumnDefinition {
    pub fn is_generated(&self) -> bool {
        self.generated_expr.is_some()
    }

    pub fn is_insertable(&self) -> bool {
        !self.is_generated()
    }

    pub fn requires_system_override(&self) -> bool {
        self.identity_kind == Some('a')
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PgConstraintDefinition {
    pub table_name: String,
    pub constraint_name: String,
    pub constraint_type: char,
    pub definition: String,
    pub referenced_table: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PgEnumDefinition {
    pub type_name: String,
    pub labels: Vec<String>,
}
