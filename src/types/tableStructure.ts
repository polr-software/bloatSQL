import { TableColumn } from './database';

export interface ParsedDataType {
  baseType: string;
  lengthOrSet: string | null;
}

export interface DisplayColumn extends TableColumn {
  parsed: ParsedDataType;
  displayLength: string | null;
}

export type AlterOperationType =
  | 'ADD_COLUMN'
  | 'DROP_COLUMN'
  | 'MODIFY_COLUMN'
  | 'RENAME_COLUMN';

export interface ColumnDefinition {
  name: string;
  dataType: string;
  length?: number;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string | null;
}

export interface AlterColumnOperation {
  type: AlterOperationType;
  columnName: string;
  newColumnName?: string;
  newDefinition?: ColumnDefinition;
}

export interface ApplySchemaOperationsRequest {
  tableName: string;
  operations: AlterColumnOperation[];
}

export interface ApplySchemaOperationsFailure {
  failedOperationIndex: number;
  failedOperationType: AlterOperationType;
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  failedStatement?: string;
}

export interface ApplySchemaOperationsResult {
  success: boolean;
  totalOperations: number;
  executedOperations: number;
  rolledBack: boolean;
  failure?: ApplySchemaOperationsFailure;
}
