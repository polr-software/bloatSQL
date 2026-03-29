import { TauriCommands } from '../../tauri/commands';
import {
  DeleteRowsRequest,
  TableColumn,
  formatDeleteRowsError,
} from '../../types/database';

interface BuildDeleteRowsRequestParams {
  loadedTable: string | null;
  tableColumns: TableColumn[];
  targetRows: Record<string, unknown>[];
}

interface DeleteRowsFlowParams {
  request: DeleteRowsRequest;
  deleteRows: TauriCommands['deleteRows'];
  refreshTable: () => Promise<void>;
}

export interface DeleteRowsFlowResult {
  deletedCount: number;
  successMessage: string;
}

export function buildDeleteRowsRequest({
  loadedTable,
  tableColumns,
  targetRows,
}: BuildDeleteRowsRequestParams): DeleteRowsRequest {
  if (!loadedTable) {
    throw new Error('No table selected.');
  }

  const primaryKeyColumn = tableColumns.find((col) => col.isPrimaryKey);
  if (!primaryKeyColumn) {
    throw new Error('No primary key column found for this table.');
  }

  return {
    tableName: loadedTable,
    primaryKeyColumn: primaryKeyColumn.name,
    primaryKeyValues: targetRows.map((row) => String(row[primaryKeyColumn.name])),
  };
}

export async function deleteRowsFlow({
  request,
  deleteRows,
  refreshTable,
}: DeleteRowsFlowParams): Promise<DeleteRowsFlowResult> {
  const result = await deleteRows(request);

  if (!result.success) {
    throw new Error(
      result.error ? formatDeleteRowsError(result.error) : 'Failed to delete rows'
    );
  }

  await refreshTable();

  const deletedCount = result.deletedCount;
  const successMessage = deletedCount > 1 ? `Deleted ${deletedCount} rows` : 'Deleted 1 row';

  return {
    deletedCount,
    successMessage,
  };
}
