export enum DatabaseType {
  MariaDB = "mariadb",
  PostgreSQL = "postgresql",
}

export interface Connection {
  id: string;
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: 'disabled' | 'preferred' | 'required';
}

export interface ConnectionFormData {
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: 'disabled' | 'preferred' | 'required';
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
  truncated: boolean;
}

export interface QueryError {
  message: string;
  code?: string;
}

export interface ExecuteQueryRequest {
  connectionId: string;
  query: string;
}

export interface ExecuteQueryResponse {
  success: boolean;
  data?: QueryResult;
  error?: QueryError;
}

export enum DataExportMode {
  NoData = "no_data",
  Insert = "insert",
  Replace = "replace",
  InsertIgnore = "insert_ignore",
}

export interface ExportOptions {
  includeDrop: boolean;
  includeCreate: boolean;
  dataMode: DataExportMode;
  selectedTables: string[];
  outputPath: string;
  fileName: string;
  maxInsertSize: number;
}

export interface TableColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  columnDefault?: string | null;
  characterMaximumLength?: number | null;
  numericPrecision?: number | null;
}

export interface TableRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
}

export interface AddRowValue {
  columnName: string;
  value: string | null;
  useDefault: boolean;
}

export interface AddRowRequest {
  tableName: string;
  values: AddRowValue[];
}

// Cell update types
export interface UpdateCellRequest {
  tableName: string;
  columnName: string;
  newValue: string | null;
  primaryKeyColumn: string;
  primaryKeyValue: string;
}

export interface MutationErrorDetails {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
}

export interface AddRowError extends MutationErrorDetails {
  table: string;
}

export interface AddRowResult {
  success: boolean;
  insertedCount: number;
  error?: AddRowError;
  executedQuery?: string;
}

export interface UpdateCellError extends MutationErrorDetails {
  table: string;
  column: string;
}

export interface UpdateCellResult {
  success: boolean;
  error?: UpdateCellError;
  executedQuery?: string;
}

export interface DeleteRowsRequest {
  tableName: string;
  primaryKeyColumn: string;
  primaryKeyValues: string[];
}

export interface DeleteRowsError extends MutationErrorDetails {
  table: string;
  primaryKeyColumn: string;
}

export interface DeleteRowsResult {
  success: boolean;
  deletedCount: number;
  error?: DeleteRowsError;
  executedQuery?: string;
}

export function formatMutationError(error: MutationErrorDetails): string {
  const parts: string[] = [];

  parts.push(error.message);

  if (error.detail) {
    parts.push(`\nDetail: ${error.detail}`);
  }

  if (error.hint) {
    parts.push(`\nHint: ${error.hint}`);
  }

  if (error.code) {
    parts.push(`\n(Error code: ${error.code})`);
  }

  return parts.join('');
}

/**
 * Formats an UpdateCellError into a user-friendly message.
 */
export function formatUpdateCellError(error: UpdateCellError): string {
  return formatMutationError(error);
}

export function formatAddRowError(error: AddRowError): string {
  return formatMutationError(error);
}

export function formatDeleteRowsError(error: DeleteRowsError): string {
  return formatMutationError(error);
}
