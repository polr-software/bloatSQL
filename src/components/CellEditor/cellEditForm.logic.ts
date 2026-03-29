import { TauriCommands } from '../../tauri/commands';
import { formatUpdateCellError, UpdateCellRequest } from '../../types/database';
import { CellEditData } from '../../stores/editCellStore';

export function formatCellInputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function isMultilineCellValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value.length > 100 || value.includes('\n');
}

export function buildCellEditInitialValues(
  selectedCell: CellEditData | null
): Record<string, string> {
  if (!selectedCell) {
    return {};
  }

  return Object.entries(selectedCell.rowData).reduce((acc, [key, value]) => {
    acc[key] = formatCellInputValue(value);
    return acc;
  }, {} as Record<string, string>);
}

export function getCellEditValidationError(selectedCell: CellEditData | null): string | null {
  if (!selectedCell || !selectedCell.tableName) {
    return 'Cannot update: table name not available';
  }

  if (!selectedCell.primaryKeyColumn || selectedCell.primaryKeyValue === undefined) {
    return 'Cannot update: primary key not found. Updates require a primary key.';
  }

  return null;
}

export function buildChangedCellRequests(
  selectedCell: CellEditData,
  values: Record<string, string>
): UpdateCellRequest[] {
  const validColumns = Object.keys(selectedCell.rowData);

  return Object.entries(values)
    .filter(([key, value]) => {
      if (!validColumns.includes(key)) return false;
      const originalValue = formatCellInputValue(selectedCell.rowData[key]);
      return value !== originalValue;
    })
    .map(([columnName, newValue]) => ({
      tableName: selectedCell.tableName ?? '',
      columnName,
      newValue: newValue === '' ? null : newValue,
      primaryKeyColumn: selectedCell.primaryKeyColumn ?? '',
      primaryKeyValue: String(selectedCell.primaryKeyValue),
    }));
}

interface SubmitCellEditParams {
  requests: UpdateCellRequest[];
  updateCell: TauriCommands['updateCell'];
  refreshTable: () => Promise<void>;
  addConsoleLog: (action: string) => void;
}

export interface SubmitCellEditResult {
  updatedColumns: string[];
  executedQueries: string[];
}

export async function submitChangedCellRequests({
  requests,
  updateCell,
  refreshTable,
  addConsoleLog,
}: SubmitCellEditParams): Promise<SubmitCellEditResult> {
  if (requests.length === 0) {
    return {
      updatedColumns: [],
      executedQueries: [],
    };
  }

  try {
    const executedQueries: string[] = [];

    for (const request of requests) {
      const result = await updateCell(request);

      if (!result.success) {
        throw new Error(
          result.error ? formatUpdateCellError(result.error) : 'Failed to update cell'
        );
      }

      if (result.executedQuery) {
        addConsoleLog(result.executedQuery);
        executedQueries.push(result.executedQuery);
      }
    }

    await refreshTable();

    return {
      updatedColumns: requests.map((request) => request.columnName),
      executedQueries,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`Failed to update cell: ${message}`);
  }
}
