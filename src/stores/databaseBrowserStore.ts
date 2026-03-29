import { create } from 'zustand';
import { DatabaseType } from '../types/database';
import { tauriCommands } from '../tauri/commands';
import { useConnectionStore } from './connectionStore';
import { useConsoleLogStore } from './consoleLogStore';
import { useQueryExecutionStore } from './queryExecutionStore';
import { schemaStore } from './schemaStore';
import { useTableMetadataStore } from './tableMetadataStore';
import { parseQueryStoreError } from './queryStore.utils';

interface DatabaseBrowserState {
  tables: string[] | null;
  isLoadingTables: boolean;
  databases: string[];
  currentDatabase: string;
  isLoadingDatabases: boolean;
  error: string | null;
}

interface DatabaseBrowserActions {
  loadTables: () => Promise<void>;
  loadDatabases: () => Promise<void>;
  changeDatabase: (databaseName: string) => Promise<void>;
  resetDatabaseState: () => void;
  clearError: () => void;
}

type DatabaseBrowserStore = DatabaseBrowserState & DatabaseBrowserActions;

export const useDatabaseBrowserStore = create<DatabaseBrowserStore>((set, get) => ({
  tables: null,
  isLoadingTables: false,
  databases: [],
  currentDatabase: '',
  isLoadingDatabases: false,
  error: null,

  loadTables: async () => {
    set({ isLoadingTables: true, error: null });

    try {
      const tables = await tauriCommands.listTables();
      set({ tables, isLoadingTables: false });
      void useTableMetadataStore.getState().loadTableColumnsMap(tables);
    } catch (error) {
      set({
        error: parseQueryStoreError(error),
        isLoadingTables: false,
      });
    }
  },

  loadDatabases: async () => {
    set({ isLoadingDatabases: true, error: null });

    try {
      const [databases, currentDatabase] = await Promise.all([
        tauriCommands.listDatabases(),
        tauriCommands.getCurrentDatabase(),
      ]);

      set({
        databases,
        currentDatabase,
        isLoadingDatabases: false,
      });

      if (currentDatabase) {
        await get().loadTables();
      }
    } catch (error) {
      set({
        error: parseQueryStoreError(error),
        isLoadingDatabases: false,
      });
    }
  },

  changeDatabase: async (databaseName) => {
    set({
      isLoadingTables: true,
      error: null,
      tables: null,
    });

    const activeConnection = useConnectionStore.getState().activeConnection;
    const logCommand =
      activeConnection?.dbType === DatabaseType.PostgreSQL
        ? `\\c ${databaseName}`
        : `USE \`${databaseName}\`;`;

    useConsoleLogStore.getState().addLog(logCommand);

    try {
      await tauriCommands.changeDatabase(databaseName);

      const tables = await tauriCommands.listTables();
      useQueryExecutionStore.getState().resetExecutionContext();
      useTableMetadataStore.getState().resetTableColumnsMap();

      set({
        currentDatabase: databaseName,
        tables,
        isLoadingTables: false,
      });

      void useTableMetadataStore.getState().loadTableColumnsMap(tables);
    } catch (error) {
      set({
        error: parseQueryStoreError(error),
        isLoadingTables: false,
      });
    }
  },

  resetDatabaseState: () => {
    useQueryExecutionStore.getState().resetExecutionContext();
    schemaStore.getState().invalidateSchema();
    useTableMetadataStore.getState().resetTableColumnsMap();

    set({
      databases: [],
      currentDatabase: '',
      tables: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));

export const useTables = () => useDatabaseBrowserStore((s) => s.tables);
export const useIsLoadingTables = () =>
  useDatabaseBrowserStore((s) => s.isLoadingTables);
export const useDatabases = () => useDatabaseBrowserStore((s) => s.databases);
export const useCurrentDatabase = () =>
  useDatabaseBrowserStore((s) => s.currentDatabase);
export const useIsLoadingDatabases = () =>
  useDatabaseBrowserStore((s) => s.isLoadingDatabases);
export const useLoadTables = () => useDatabaseBrowserStore((s) => s.loadTables);
export const useLoadDatabases = () =>
  useDatabaseBrowserStore((s) => s.loadDatabases);
export const useChangeDatabase = () =>
  useDatabaseBrowserStore((s) => s.changeDatabase);
export const useResetDatabaseState = () =>
  useDatabaseBrowserStore((s) => s.resetDatabaseState);
