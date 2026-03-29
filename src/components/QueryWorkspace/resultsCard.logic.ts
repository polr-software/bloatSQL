import { type RowSelectionState } from '@tanstack/react-table';
import { type NotificationData } from '@mantine/notifications';
import { TauriCommands } from '../../tauri/commands';
import { QueryResult, TableColumn } from '../../types/database';
import { CellEditData } from '../../stores/editCellStore';
import { buildDeleteRowsRequest, deleteRowsFlow } from './deleteRowsFlow';

interface BuildSelectedCellParams {
  rowIndex: number;
  columnName: string;
  rowData: Record<string, unknown>;
  visibleColumnNames: string[];
  loadedTable: string | null;
  tableColumns: TableColumn[];
}

export function buildSelectedCellData({
  rowIndex,
  columnName,
  rowData,
  visibleColumnNames,
  loadedTable,
  tableColumns,
}: BuildSelectedCellParams): CellEditData {
  const primaryKeyColumn = tableColumns.find((column) => column.isPrimaryKey);

  return {
    rowIndex,
    columnName,
    focusedColumn: columnName,
    rowData,
    visibleColumnNames,
    tableName: loadedTable,
    primaryKeyColumn: primaryKeyColumn?.name,
    primaryKeyValue: primaryKeyColumn ? rowData[primaryKeyColumn.name] : undefined,
    columns: tableColumns,
  };
}

interface ResolveContextMenuTargetRowsParams {
  contextMenuRowData: Record<string, unknown> | null;
  rowSelection: RowSelectionState;
  rows: Record<string, unknown>[];
}

export function resolveContextMenuTargetRows({
  contextMenuRowData,
  rowSelection,
  rows,
}: ResolveContextMenuTargetRowsParams): Record<string, unknown>[] {
  if (!contextMenuRowData) {
    return [];
  }

  const selectedRows = Object.keys(rowSelection)
    .filter((id) => rowSelection[id])
    .map((id) => rows[parseInt(id, 10)])
    .filter(Boolean) as Record<string, unknown>[];

  const rightClickedIsSelected = selectedRows.some((row) => row === contextMenuRowData);
  if (rightClickedIsSelected && selectedRows.length > 1) {
    return selectedRows;
  }

  return [contextMenuRowData];
}

export function buildTruncatedResultsMessage(results: QueryResult | null): string | null {
  if (!results?.truncated) {
    return null;
  }

  return `Showing the first ${results.rows.length.toLocaleString()} rows out of ${results.rowCount.toLocaleString()}.`;
}

interface DeleteRowsFromResultsParams {
  loadedTable: string | null;
  tableColumns: TableColumn[];
  targetRows: Record<string, unknown>[];
  deleteRows: TauriCommands['deleteRows'];
  refreshTable: () => Promise<void>;
}

export type ResultsNotification = Pick<NotificationData, 'title' | 'message' | 'color'>;

export async function deleteRowsFromResults({
  loadedTable,
  tableColumns,
  targetRows,
  deleteRows,
  refreshTable,
}: DeleteRowsFromResultsParams): Promise<ResultsNotification> {
  let request;

  try {
    request = buildDeleteRowsRequest({
      loadedTable,
      tableColumns,
      targetRows,
    });
  } catch (error) {
    return {
      title: 'Cannot delete',
      message: error instanceof Error ? error.message : String(error),
      color: 'red',
    };
  }

  try {
    const result = await deleteRowsFlow({
      request,
      deleteRows,
      refreshTable,
    });

    return {
      title: targetRows.length > 1 ? 'Rows deleted' : 'Row deleted',
      message: result.successMessage,
      color: 'green',
    };
  } catch (error) {
    return {
      title: 'Delete failed',
      message: error instanceof Error ? error.message : String(error),
      color: 'red',
    };
  }
}
