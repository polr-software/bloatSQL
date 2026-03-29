import { create } from 'zustand';
import { tauriCommands } from '../tauri/commands';

interface TableMetadataState {
  tableColumnsMap: Record<string, string[]>;
}

interface TableMetadataActions {
  loadTableColumnsMap: (tables: string[] | null) => Promise<void>;
  resetTableColumnsMap: () => void;
}

type TableMetadataStore = TableMetadataState & TableMetadataActions;

export const useTableMetadataStore = create<TableMetadataStore>((set) => ({
  tableColumnsMap: {},

  loadTableColumnsMap: async (tables) => {
    if (!tables || tables.length === 0) {
      set({ tableColumnsMap: {} });
      return;
    }

    try {
      const entries = await Promise.all(
        tables.map(async (table) => {
          const columns = await tauriCommands.getTableColumns(table);
          return [table, columns.map((column) => column.name)] as const;
        })
      );

      set({ tableColumnsMap: Object.fromEntries(entries) });
    } catch {
      // Autocomplete metadata is non-critical.
    }
  },

  resetTableColumnsMap: () => {
    set({ tableColumnsMap: {} });
  },
}));

export const useTableColumnsMap = () => useTableMetadataStore((s) => s.tableColumnsMap);
export const useLoadTableColumnsMap = () => useTableMetadataStore((s) => s.loadTableColumnsMap);
