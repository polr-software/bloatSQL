import { create } from 'zustand';
import { TableColumn } from '../types/database';

export interface CellEditData {
  rowIndex: number;
  columnName: string;
  focusedColumn: string;
  rowData: Record<string, unknown>;
  visibleColumnNames: string[];
  tableName: string | null;
  primaryKeyColumn?: string;
  primaryKeyValue?: unknown;
  columns?: TableColumn[];
}

interface EditCellState {
  selectedCell: CellEditData | null;
  isEditing: boolean;
  isSaving: boolean;
  error: string | null;
  isAddingRow: boolean;
  addRowTableName: string | null;
  addRowColumns: TableColumn[];
}

interface EditCellActions {
  selectCell: (data: CellEditData) => void;
  clearSelection: () => void;
  setError: (error: string | null) => void;
  setSaving: (isSaving: boolean) => void;
  startAddRow: (tableName: string, columns: TableColumn[]) => void;
  stopAddRow: () => void;
}

type EditCellStore = EditCellState & EditCellActions;

export const useEditCellStore = create<EditCellStore>((set) => ({
  selectedCell: null,
  isEditing: false,
  isSaving: false,
  error: null,
  isAddingRow: false,
  addRowTableName: null,
  addRowColumns: [],

  selectCell: (data) => {
    set({
      selectedCell: data,
      isEditing: true,
      error: null,
      isAddingRow: false,
      addRowTableName: null,
      addRowColumns: [],
    });
  },

  clearSelection: () => {
    set({
      selectedCell: null,
      isEditing: false,
      error: null,
    });
  },

  setError: (error) => {
    set({ error });
  },

  setSaving: (isSaving) => {
    set({ isSaving });
  },

  startAddRow: (tableName, columns) => {
    set({
      isAddingRow: true,
      addRowTableName: tableName,
      addRowColumns: columns,
      selectedCell: null,
      isEditing: false,
      error: null,
    });
  },

  stopAddRow: () => {
    set({
      isAddingRow: false,
      addRowTableName: null,
      addRowColumns: [],
      error: null,
    });
  },
}));

export const useSelectedCell = () => useEditCellStore((s) => s.selectedCell);
export const useIsEditingCell = () => useEditCellStore((s) => s.isEditing);
export const useIsSavingCell = () => useEditCellStore((s) => s.isSaving);
export const useEditCellError = () => useEditCellStore((s) => s.error);
export const useSelectCell = () => useEditCellStore((s) => s.selectCell);
export const useClearCellSelection = () => useEditCellStore((s) => s.clearSelection);
export const useSetEditCellError = () => useEditCellStore((s) => s.setError);
export const useSetSavingCell = () => useEditCellStore((s) => s.setSaving);
export const useIsAddingRow = () => useEditCellStore((s) => s.isAddingRow);
export const useAddRowTableName = () => useEditCellStore((s) => s.addRowTableName);
export const useAddRowColumns = () => useEditCellStore((s) => s.addRowColumns);
export const useStartAddRow = () => useEditCellStore((s) => s.startAddRow);
export const useStopAddRow = () => useEditCellStore((s) => s.stopAddRow);
