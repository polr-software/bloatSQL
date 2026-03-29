pub mod connection;
pub mod factory;
pub mod mariadb;
pub mod postgresql;

#[cfg(test)]
mod integration_tests;

pub use connection::{DatabaseConnection, QueryResult, TableColumn, TableRelationship};
pub use factory::create_connection;
