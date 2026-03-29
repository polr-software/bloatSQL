import { TauriCommands } from '../../tauri/commands';
import { TableColumn } from '../../types/database';
import { addRowFlow, type AddRowFlowResult, buildAddRowRequest } from './addRowFlow';

export function isAddRowColumnRequired(column: TableColumn): boolean {
  return !column.isNullable && !column.isPrimaryKey && column.columnDefault == null;
}

export function canAddRowColumnBeNull(column: TableColumn): boolean {
  return column.isNullable;
}

export function buildAddRowInitialValues(columns: TableColumn[]): Record<string, string> {
  return columns.reduce((acc, column) => {
    acc[column.name] = '';
    return acc;
  }, {} as Record<string, string>);
}

export function validateAddRowValues(
  columns: TableColumn[],
  values: Record<string, string>,
  nullColumns: Record<string, boolean> = {}
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const column of columns) {
    if (nullColumns[column.name]) {
      continue;
    }

    if (
      isAddRowColumnRequired(column) &&
      (!values[column.name] || values[column.name].trim() === '')
    ) {
      errors[column.name] = 'To pole jest wymagane';
    }
  }

  return errors;
}

export function getAddRowPlaceholder(column: TableColumn): string {
  if (column.columnDefault) {
    return `Default: ${column.columnDefault}`;
  }

  if (column.isPrimaryKey) {
    return 'Leave empty for DEFAULT';
  }

  if (!isAddRowColumnRequired(column)) {
    return 'Leave empty for DEFAULT';
  }

  return 'Required';
}

export function getAddRowDescription(column: TableColumn, useNull: boolean): string | null {
  if (useNull) {
    return 'This column will be inserted as SQL NULL.';
  }

  if (column.isNullable) {
    return 'Leave empty to use database DEFAULT. Use NULL to force SQL NULL.';
  }

  if (column.columnDefault || column.isPrimaryKey) {
    return 'Leave empty to use database DEFAULT.';
  }

  return null;
}

interface SubmitAddRowFormParams {
  tableName: string | null;
  columns: TableColumn[];
  values: Record<string, string>;
  nullColumns?: Record<string, boolean>;
  addRow: TauriCommands['addRow'];
  refreshTable: () => Promise<void>;
}

export async function submitAddRowForm({
  tableName,
  columns,
  values,
  nullColumns,
  addRow,
  refreshTable,
}: SubmitAddRowFormParams): Promise<AddRowFlowResult> {
  const request = buildAddRowRequest({
    tableName,
    columns,
    values,
    nullColumns,
  });

  return addRowFlow({
    request,
    addRow,
    refreshTable,
  });
}
