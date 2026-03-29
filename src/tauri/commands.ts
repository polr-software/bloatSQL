import { invoke } from '@tauri-apps/api/core';
import {
  Connection,
  QueryResult,
  ExportOptions,
  TableColumn,
  TableRelationship,
  AddRowRequest,
  AddRowResult,
  UpdateCellRequest,
  UpdateCellResult,
  DeleteRowsRequest,
  DeleteRowsResult,
} from '../types/database';
import {
  ApplySchemaOperationsRequest,
  ApplySchemaOperationsResult,
  AlterColumnOperation,
  ColumnDefinition,
} from '../types/tableStructure';

interface BackendConnection {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl_mode: string;
}

interface BackendExportOptions {
  include_drop: boolean;
  include_create: boolean;
  data_mode: string;
  selected_tables: string[];
  output_path: string;
  file_name: string;
  max_insert_size: number;
}

interface BackendTableColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  column_default?: string | null;
  character_maximum_length?: number | null;
  numeric_precision?: number | null;
}

interface BackendTableRelationship {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  constraint_name: string;
}

interface BackendQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  execution_time: number;
  truncated: boolean;
}

interface BackendSchemaColumnDefinition {
  name: string;
  data_type: string;
  length?: number | null;
  is_nullable: boolean;
  is_primary_key: boolean;
  default_value?: string | null;
}

interface BackendSchemaOperation {
  type: AlterColumnOperation['type'];
  column_name: string;
  new_column_name?: string;
  new_definition?: BackendSchemaColumnDefinition;
}

interface BackendApplySchemaOperationsResult {
  success: boolean;
  total_operations: number;
  executed_operations: number;
  rolled_back: boolean;
  failure?: {
    failed_operation_index: number;
    failed_operation_type: AlterColumnOperation['type'];
    message: string;
    code?: string;
    detail?: string;
    hint?: string;
    failed_statement?: string;
  };
}

interface BackendUpdateCellResult {
  success: boolean;
  error?: {
    message: string;
    code?: string;
    detail?: string;
    hint?: string;
    table: string;
    column: string;
  };
  executed_query?: string;
}

interface BackendAddRowResult {
  success: boolean;
  inserted_count: number;
  error?: {
    message: string;
    code?: string;
    detail?: string;
    hint?: string;
    table: string;
  };
  executed_query?: string;
}

interface BackendDeleteRowsResult {
  success: boolean;
  deleted_count: number;
  error?: {
    message: string;
    code?: string;
    detail?: string;
    hint?: string;
    table: string;
    primary_key_column: string;
  };
  executed_query?: string;
}

function toFrontendTableColumn(col: BackendTableColumn): TableColumn {
  return {
    name: col.name,
    dataType: col.data_type,
    isNullable: col.is_nullable,
    isPrimaryKey: col.is_primary_key,
    columnDefault: col.column_default,
    characterMaximumLength: col.character_maximum_length,
    numericPrecision: col.numeric_precision,
  };
}

function toFrontendTableRelationship(rel: BackendTableRelationship): TableRelationship {
  return {
    fromTable: rel.from_table,
    fromColumn: rel.from_column,
    toTable: rel.to_table,
    toColumn: rel.to_column,
    constraintName: rel.constraint_name,
  };
}

function toFrontendQueryResult(result: BackendQueryResult): QueryResult {
  return {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.row_count,
    executionTime: result.execution_time,
    truncated: result.truncated,
  };
}

function toBackendColumnDefinition(definition: ColumnDefinition): BackendSchemaColumnDefinition {
  return {
    name: definition.name,
    data_type: definition.dataType,
    length: definition.length ?? null,
    is_nullable: definition.isNullable,
    is_primary_key: definition.isPrimaryKey,
    default_value: definition.defaultValue ?? null,
  };
}

function toBackendSchemaOperation(operation: AlterColumnOperation): BackendSchemaOperation {
  return {
    type: operation.type,
    column_name: operation.columnName,
    new_column_name: operation.newColumnName,
    new_definition: operation.newDefinition
      ? toBackendColumnDefinition(operation.newDefinition)
      : undefined,
  };
}

function toFrontendApplySchemaOperationsResult(
  result: BackendApplySchemaOperationsResult
): ApplySchemaOperationsResult {
  return {
    success: result.success,
    totalOperations: result.total_operations,
    executedOperations: result.executed_operations,
    rolledBack: result.rolled_back,
    failure: result.failure
      ? {
          failedOperationIndex: result.failure.failed_operation_index,
          failedOperationType: result.failure.failed_operation_type,
          message: result.failure.message,
          code: result.failure.code,
          detail: result.failure.detail,
          hint: result.failure.hint,
          failedStatement: result.failure.failed_statement,
        }
      : undefined,
  };
}

function toFrontendUpdateCellResult(result: BackendUpdateCellResult): UpdateCellResult {
  return {
    success: result.success,
    error: result.error,
    executedQuery: result.executed_query,
  };
}

function toFrontendAddRowResult(result: BackendAddRowResult): AddRowResult {
  return {
    success: result.success,
    insertedCount: result.inserted_count,
    error: result.error,
    executedQuery: result.executed_query,
  };
}

function toFrontendDeleteRowsResult(result: BackendDeleteRowsResult): DeleteRowsResult {
  return {
    success: result.success,
    deletedCount: result.deleted_count,
    error: result.error
      ? {
          message: result.error.message,
          code: result.error.code,
          detail: result.error.detail,
          hint: result.error.hint,
          table: result.error.table,
          primaryKeyColumn: result.error.primary_key_column,
        }
      : undefined,
    executedQuery: result.executed_query,
  };
}

function toBackendConnection(conn: Connection | Omit<Connection, 'id'> & { id?: string }): BackendConnection {
  return {
    id: conn.id || crypto.randomUUID(),
    name: conn.name,
    db_type: conn.dbType,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    database: conn.database,
    ssl_mode: conn.sslMode,
  };
}

function toFrontendConnection(conn: BackendConnection): Connection {
  return {
    id: conn.id,
    name: conn.name,
    dbType: conn.db_type as Connection['dbType'],
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    database: conn.database,
    sslMode: conn.ssl_mode as Connection['sslMode'],
  };
}

function toBackendExportOptions(options: ExportOptions): BackendExportOptions {
  return {
    include_drop: options.includeDrop,
    include_create: options.includeCreate,
    data_mode: options.dataMode,
    selected_tables: options.selectedTables,
    output_path: options.outputPath,
    file_name: options.fileName,
    max_insert_size: options.maxInsertSize,
  };
}

export const tauriCommands = {
  async saveConnection(conn: Omit<Connection, 'id'> & { id?: string }): Promise<Connection> {
    const backendConn = toBackendConnection(conn);
    await invoke('save_connection', { conn: backendConn });
    return toFrontendConnection(backendConn);
  },

  async getConnections(): Promise<Connection[]> {
    const rawConnections = await invoke<BackendConnection[]>('get_connections');
    return rawConnections.map(toFrontendConnection);
  },

  async deleteConnection(id: string): Promise<void> {
    await invoke('delete_connection', { id });
  },

  async testConnection(conn: Connection): Promise<void> {
    await invoke('test_connection', { conn: toBackendConnection(conn) });
  },

  async connectToDatabase(conn: Connection): Promise<void> {
    await invoke('connect_to_database', { conn: toBackendConnection(conn) });
  },

  async disconnectFromDatabase(): Promise<void> {
    await invoke('disconnect_from_database');
  },

  async executeQuery(query: string): Promise<QueryResult> {
    const result = await invoke<BackendQueryResult>('execute_query', { query });
    return toFrontendQueryResult(result);
  },

  async listTables(): Promise<string[]> {
    return invoke<string[]>('list_tables');
  },

  async listDatabases(): Promise<string[]> {
    return invoke<string[]>('list_databases');
  },

  async changeDatabase(databaseName: string): Promise<void> {
    await invoke('change_database', { databaseName });
  },

  async getCurrentDatabase(): Promise<string> {
    return invoke<string>('get_current_database');
  },

  async getTableColumns(tableName: string): Promise<TableColumn[]> {
    const rawColumns = await invoke<BackendTableColumn[]>('get_table_columns', { tableName });
    return rawColumns.map(toFrontendTableColumn);
  },

  async getTableRelationships(): Promise<TableRelationship[]> {
    const rawRelationships = await invoke<BackendTableRelationship[]>('get_table_relationships');
    return rawRelationships.map(toFrontendTableRelationship);
  },

  async exportDatabase(options: ExportOptions): Promise<void> {
    await invoke('export_database', { options: toBackendExportOptions(options) });
  },

  async closeSplashscreen(): Promise<void> {
    await invoke('close_splashscreen');
  },

  async pingConnection(): Promise<number> {
    return invoke<number>('ping_connection');
  },

  async addRow(params: AddRowRequest): Promise<AddRowResult> {
    const result = await invoke<BackendAddRowResult>('add_row', {
      request: {
        table_name: params.tableName,
        values: params.values.map((value) => ({
          column_name: value.columnName,
          value: value.value,
          use_default: value.useDefault,
        })),
      },
    });

    return toFrontendAddRowResult(result);
  },

  async updateCell(params: UpdateCellRequest): Promise<UpdateCellResult> {
    const request = {
      table_name: params.tableName,
      column_name: params.columnName,
      new_value: params.newValue,
      primary_key_column: params.primaryKeyColumn,
      primary_key_value: params.primaryKeyValue,
    };

    const result = await invoke<BackendUpdateCellResult>('update_cell', { request });
    return toFrontendUpdateCellResult(result);
  },

  async deleteRows(params: DeleteRowsRequest): Promise<DeleteRowsResult> {
    const result = await invoke<BackendDeleteRowsResult>('delete_rows', {
      request: {
        table_name: params.tableName,
        primary_key_column: params.primaryKeyColumn,
        primary_key_values: params.primaryKeyValues,
      },
    });

    return toFrontendDeleteRowsResult(result);
  },

  async applySchemaOperations(
    params: ApplySchemaOperationsRequest
  ): Promise<ApplySchemaOperationsResult> {
    const result = await invoke<BackendApplySchemaOperationsResult>(
      'apply_schema_operations',
      {
        request: {
          table_name: params.tableName,
          operations: params.operations.map(toBackendSchemaOperation),
        },
      }
    );

    return toFrontendApplySchemaOperationsResult(result);
  },
};

export type TauriCommands = typeof tauriCommands;
