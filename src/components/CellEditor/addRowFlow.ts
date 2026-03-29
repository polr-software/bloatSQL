import { TauriCommands } from '../../tauri/commands';
import { AddRowRequest, TableColumn, formatAddRowError } from '../../types/database';

interface BuildAddRowRequestParams {
  tableName: string | null;
  columns: TableColumn[];
  values: Record<string, string>;
  nullColumns?: Record<string, boolean>;
}

interface AddRowFlowParams {
  request: AddRowRequest;
  addRow: TauriCommands['addRow'];
  refreshTable: () => Promise<void>;
}

export interface AddRowFlowResult {
  insertedCount: number;
  successMessage: string;
  executedQuery?: string;
}

export function buildAddRowRequest({
  tableName,
  columns,
  values,
  nullColumns,
}: BuildAddRowRequestParams): AddRowRequest {
  if (!tableName) {
    throw new Error('No table selected.');
  }

  return {
    tableName,
    values: columns.map((column) => {
      const useNull = Boolean(nullColumns?.[column.name]);
      const rawValue = values[column.name];

      if (useNull) {
        return {
          columnName: column.name,
          value: null,
          useDefault: false,
        };
      }

      const useDefault = rawValue === '' || rawValue === undefined;

      return {
        columnName: column.name,
        value: useDefault ? null : rawValue,
        useDefault,
      };
    }),
  };
}

export async function addRowFlow({
  request,
  addRow,
  refreshTable,
}: AddRowFlowParams): Promise<AddRowFlowResult> {
  const result = await addRow(request);

  if (!result.success) {
    throw new Error(result.error ? formatAddRowError(result.error) : 'Failed to insert row');
  }

  await refreshTable();

  const insertedCount = result.insertedCount;

  return {
    insertedCount,
    successMessage: insertedCount === 1 ? 'Inserted 1 row' : `Inserted ${insertedCount} rows`,
    executedQuery: result.executedQuery,
  };
}
