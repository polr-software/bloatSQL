import { DatabaseType } from '../../../connections';
import { AlterColumnOperation, ColumnDefinition } from '../../../types/tableStructure';

/**
 * Quote identifier based on database type
 * MariaDB uses backticks, PostgreSQL uses double quotes
 */
export function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === DatabaseType.PostgreSQL) {
    return `"${name.replace(/"/g, '""')}"`;
  }
  // MariaDB
  return `\`${name.replace(/`/g, '``')}\``;
}

/**
 * Build column definition SQL (type, nullable, default)
 */
export function buildColumnDefinitionSQL(
  def: ColumnDefinition,
  dbType: DatabaseType
): string {
  const parts: string[] = [];

  // Data type with length
  let typeStr = def.dataType.toUpperCase();
  if (def.length && needsLength(def.dataType)) {
    typeStr += `(${def.length})`;
  }
  parts.push(typeStr);

  // Nullable
  if (def.isNullable) {
    parts.push('NULL');
  } else {
    parts.push('NOT NULL');
  }

  // Default value
  if (def.defaultValue !== undefined && def.defaultValue !== null && def.defaultValue !== '') {
    const formattedDefault = formatDefaultValue(def.defaultValue, def.dataType, dbType);
    parts.push(`DEFAULT ${formattedDefault}`);
  }

  return parts.join(' ');
}

/**
 * Check if data type needs length specification
 */
function needsLength(dataType: string): boolean {
  const typesWithLength = [
    'VARCHAR', 'CHAR', 'VARBINARY', 'BINARY',
    'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
    'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE',
  ];
  return typesWithLength.includes(dataType.toUpperCase());
}

/**
 * Format default value based on data type
 */
function formatDefaultValue(value: string, dataType: string, _dbType: DatabaseType): string {
  const upperType = dataType.toUpperCase();

  // NULL
  if (value.toUpperCase() === 'NULL') {
    return 'NULL';
  }

  // Functions like CURRENT_TIMESTAMP, NOW(), etc.
  const functions = ['CURRENT_TIMESTAMP', 'NOW()', 'CURRENT_DATE', 'CURRENT_TIME', 'UUID()'];
  if (functions.some(f => value.toUpperCase() === f || value.toUpperCase().startsWith(f))) {
    return value.toUpperCase();
  }

  // Numeric types - no quotes
  const numericTypes = ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL'];
  if (numericTypes.includes(upperType)) {
    return value;
  }

  // Boolean
  if (upperType === 'BOOLEAN' || upperType === 'BOOL') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') return 'TRUE';
    if (lower === 'false' || lower === '0') return 'FALSE';
    return value;
  }

  // String types - quote with single quotes
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build ALTER TABLE SQL statements for a list of operations
 * Returns an array of SQL statements to execute
 */
export function buildAlterTableSQL(
  tableName: string,
  operations: AlterColumnOperation[],
  dbType: DatabaseType
): string[] {
  const statements: string[] = [];
  const quotedTable = quoteIdentifier(tableName, dbType);

  for (const op of operations) {
    switch (op.type) {
      case 'ADD_COLUMN':
        if (op.newDefinition) {
          statements.push(buildAddColumnSQL(quotedTable, op.newDefinition, dbType));
        }
        break;

      case 'DROP_COLUMN':
        statements.push(buildDropColumnSQL(quotedTable, op.columnName, dbType));
        break;

      case 'MODIFY_COLUMN':
        if (op.newDefinition) {
          statements.push(...buildModifyColumnSQL(quotedTable, op.columnName, op.newDefinition, dbType));
        }
        break;

      case 'RENAME_COLUMN':
        if (op.newColumnName) {
          statements.push(buildRenameColumnSQL(quotedTable, op.columnName, op.newColumnName, dbType));
        }
        break;
    }
  }

  return statements;
}

function buildAddColumnSQL(
  quotedTable: string,
  def: ColumnDefinition,
  dbType: DatabaseType
): string {
  const quotedCol = quoteIdentifier(def.name, dbType);
  const colDef = buildColumnDefinitionSQL(def, dbType);
  return `ALTER TABLE ${quotedTable} ADD COLUMN ${quotedCol} ${colDef}`;
}

function buildDropColumnSQL(
  quotedTable: string,
  columnName: string,
  dbType: DatabaseType
): string {
  const quotedCol = quoteIdentifier(columnName, dbType);
  return `ALTER TABLE ${quotedTable} DROP COLUMN ${quotedCol}`;
}

function buildModifyColumnSQL(
  quotedTable: string,
  columnName: string,
  def: ColumnDefinition,
  dbType: DatabaseType
): string[] {
  const quotedCol = quoteIdentifier(columnName, dbType);

  if (dbType === DatabaseType.PostgreSQL) {
    // PostgreSQL requires separate statements for type, nullable, and default
    const statements: string[] = [];

    // Change type
    let typeStr = def.dataType.toUpperCase();
    if (def.length && needsLength(def.dataType)) {
      typeStr += `(${def.length})`;
    }
    statements.push(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedCol} TYPE ${typeStr}`);

    // Set/drop NOT NULL
    if (def.isNullable) {
      statements.push(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedCol} DROP NOT NULL`);
    } else {
      statements.push(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedCol} SET NOT NULL`);
    }

    // Set/drop default
    if (def.defaultValue !== undefined && def.defaultValue !== null && def.defaultValue !== '') {
      const formattedDefault = formatDefaultValue(def.defaultValue, def.dataType, dbType);
      statements.push(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedCol} SET DEFAULT ${formattedDefault}`);
    } else {
      statements.push(`ALTER TABLE ${quotedTable} ALTER COLUMN ${quotedCol} DROP DEFAULT`);
    }

    return statements;
  }

  // MariaDB uses MODIFY COLUMN with full definition
  const colDef = buildColumnDefinitionSQL(def, dbType);
  return [`ALTER TABLE ${quotedTable} MODIFY COLUMN ${quotedCol} ${colDef}`];
}

function buildRenameColumnSQL(
  quotedTable: string,
  oldName: string,
  newName: string,
  dbType: DatabaseType
): string {
  const quotedOld = quoteIdentifier(oldName, dbType);
  const quotedNew = quoteIdentifier(newName, dbType);

  if (dbType === DatabaseType.PostgreSQL) {
    return `ALTER TABLE ${quotedTable} RENAME COLUMN ${quotedOld} TO ${quotedNew}`;
  }

  // MariaDB - note: CHANGE requires full column definition, but RENAME COLUMN works since 10.5.2
  // Using RENAME COLUMN for simplicity (supported in MariaDB 10.5.2+ and MySQL 8.0+)
  return `ALTER TABLE ${quotedTable} RENAME COLUMN ${quotedOld} TO ${quotedNew}`;
}

/**
 * Generate a preview of a single operation for display
 */
export function getOperationPreviewSQL(
  tableName: string,
  operation: AlterColumnOperation,
  dbType: DatabaseType
): string {
  const statements = buildAlterTableSQL(tableName, [operation], dbType);
  return statements.join(';\n');
}
