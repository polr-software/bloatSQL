import { create } from 'zustand';
import { tauriCommands } from '../tauri/commands';
import { QueryResult, TableColumn, DatabaseType } from '../types/database';
import { useConnectionStore } from './connectionStore';
import { useConsoleLogStore } from './consoleLogStore';
import { useEditCellStore } from './editCellStore';

const QUERY_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

interface QueryState {
  queryText: string;
  results: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
  lastExecutionTime: number | null;
  tables: string[] | null;
  isLoadingTables: boolean;
  loadedTable: string | null;
  tableColumns: TableColumn[];
  databases: string[];
  currentDatabase: string;
  isLoadingDatabases: boolean;
}

interface QueryActions {
  setQueryText: (text: string) => void;
  executeQuery: () => Promise<void>;
  executeQueryText: (text: string) => Promise<void>;
  loadTables: () => Promise<void>;
  loadDatabases: () => Promise<void>;
  changeDatabase: (databaseName: string) => Promise<void>;
  selectTable: (tableName: string) => Promise<void>;
  refreshTable: () => Promise<void>;
  clearResults: () => void;
  clearError: () => void;
  resetDatabaseState: () => void;
  injectBenchmarkData: (rowCount: number) => void;
}

type QueryStore = QueryState & QueryActions;

function parseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function formatTableName(tableName: string, dbType: DatabaseType | undefined): string {
  if (!dbType) return tableName;

  if (dbType === DatabaseType.PostgreSQL) {
    return `"${tableName}"`;
  } else {
    return `\`${tableName}\``;
  }
}

export const useQueryStore = create<QueryStore>((set, get) => ({
  queryText: '',
  results: null,
  isExecuting: false,
  error: null,
  lastExecutionTime: null,
  tables: null,
  isLoadingTables: false,
  loadedTable: null,
  tableColumns: [],
  databases: [],
  currentDatabase: '',
  isLoadingDatabases: false,

  setQueryText: (text) => {
    set({ queryText: text });
  },

  executeQuery: async () => {
    const { queryText } = get();
    if (!queryText.trim()) {
      set({ error: 'Query is empty' });
      return;
    }

    set({ isExecuting: true, error: null });

    useConsoleLogStore.getState().addLog(queryText);

    try {
      const results = await withTimeout(tauriCommands.executeQuery(queryText), QUERY_TIMEOUT_MS);
      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
        loadedTable: null,
        tableColumns: [],
      });
    } catch (error) {
      set({
        error: parseError(error),
        isExecuting: false,
      });
    }
  },

  executeQueryText: async (text: string) => {
    if (!text.trim()) return;

    set({ isExecuting: true, error: null });
    useConsoleLogStore.getState().addLog(text);

    try {
      const results = await withTimeout(tauriCommands.executeQuery(text), QUERY_TIMEOUT_MS);
      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
        loadedTable: null,
        tableColumns: [],
      });
    } catch (error) {
      set({ error: parseError(error), isExecuting: false });
    }
  },

  loadTables: async () => {
    set({ isLoadingTables: true, error: null });
    try {
      const tables = await tauriCommands.listTables();
      set({ tables, isLoadingTables: false });
    } catch (error) {
      set({
        error: parseError(error),
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
      set({ databases, currentDatabase, isLoadingDatabases: false });

      if (currentDatabase) {
        await get().loadTables();
      }
    } catch (error) {
      set({
        error: parseError(error),
        isLoadingDatabases: false,
      });
    }
  },

  changeDatabase: async (databaseName: string) => {
    set({ isLoadingTables: true, error: null, tables: null });

    const activeConnection = useConnectionStore.getState().activeConnection;
    const dbType = activeConnection?.dbType;

    let logCommand: string;
    if (dbType === DatabaseType.PostgreSQL) {
      logCommand = `\\c ${databaseName}`;
    } else {
      logCommand = `USE \`${databaseName}\`;`;
    }

    useConsoleLogStore.getState().addLog(logCommand);

    try {
      await tauriCommands.changeDatabase(databaseName);
      set({ currentDatabase: databaseName });
      const tables = await tauriCommands.listTables();
      set({ tables, isLoadingTables: false, loadedTable: null, tableColumns: [], results: null });
    } catch (error) {
      set({
        error: parseError(error),
        isLoadingTables: false,
      });
    }
  },

  selectTable: async (tableName: string) => {
    const { loadedTable } = get();

    if (loadedTable === tableName) {
      return;
    }

    useEditCellStore.getState().clearSelection();

    const activeConnection = useConnectionStore.getState().activeConnection;
    const formattedTableName = formatTableName(tableName, activeConnection?.dbType);
    const query = `SELECT * FROM ${formattedTableName}`;

    set({
      queryText: query,
      isExecuting: true,
      error: null,
    });

    useConsoleLogStore.getState().addLog(query);

    try {
      const [results, columns] = await Promise.all([
        withTimeout(tauriCommands.executeQuery(query), QUERY_TIMEOUT_MS),
        tauriCommands.getTableColumns(tableName),
      ]);
      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
        loadedTable: tableName,
        tableColumns: columns,
      });
    } catch (error) {
      set({
        error: parseError(error),
        isExecuting: false,
        results: null,
        loadedTable: null,
        tableColumns: [],
      });
    }
  },

  refreshTable: async () => {
    const { loadedTable } = get();
    if (!loadedTable) return;

    const activeConnection = useConnectionStore.getState().activeConnection;
    const formattedTableName = formatTableName(loadedTable, activeConnection?.dbType);
    const query = `SELECT * FROM ${formattedTableName}`;

    set({ isExecuting: true, error: null });

    useConsoleLogStore.getState().addLog(query);

    try {
      const results = await withTimeout(tauriCommands.executeQuery(query), QUERY_TIMEOUT_MS);
      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
      });
    } catch (error) {
      set({
        error: parseError(error),
        isExecuting: false,
      });
    }
  },

  clearResults: () => {
    set({ results: null, error: null, lastExecutionTime: null, loadedTable: null });
  },

  injectBenchmarkData: (rowCount: number) => {
    const columns = ['id', 'name', 'email', 'city', 'country', 'status', 'score', 'created_at', 'balance', 'is_active'];
    const statuses = ['active', 'inactive', 'pending', 'banned'];
    const cities = ['Warsaw', 'Krakow', 'Gdansk', 'Wroclaw', 'Poznan', 'Berlin', 'Prague', 'Vienna'];
    const countries = ['Poland', 'Germany', 'Czech Republic', 'Austria'];

    const rows: Record<string, unknown>[] = Array.from({ length: rowCount }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      city: cities[i % cities.length],
      country: countries[i % countries.length],
      status: statuses[i % statuses.length],
      score: ((i * 7919) % 1000) / 10,
      created_at: `${2020 + (i % 5)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      balance: ((i * 12347) % 100000) / 100,
      is_active: i % 3 !== 0,
    }));

    set({
      results: { columns, rows, rowCount, executionTime: 0 },
      isExecuting: false,
      error: null,
      loadedTable: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },

  resetDatabaseState: () => {
    set({
      databases: [],
      currentDatabase: '',
      tables: null,
      loadedTable: null,
      tableColumns: [],
      results: null,
    });
  },
}));

export const useQueryText = () => useQueryStore((s) => s.queryText);
export const useSetQueryText = () => useQueryStore((s) => s.setQueryText);
export const useQueryResults = () => useQueryStore((s) => s.results);
export const useIsExecuting = () => useQueryStore((s) => s.isExecuting);
export const useQueryError = () => useQueryStore((s) => s.error);
export const useLastExecutionTime = () => useQueryStore((s) => s.lastExecutionTime);
export const useTables = () => useQueryStore((s) => s.tables);
export const useIsLoadingTables = () => useQueryStore((s) => s.isLoadingTables);
export const useLoadedTable = () => useQueryStore((s) => s.loadedTable);
export const useTableColumns = () => useQueryStore((s) => s.tableColumns);
export const useExecuteQuery = () => useQueryStore((s) => s.executeQuery);
export const useExecuteQueryText = () => useQueryStore((s) => s.executeQueryText);
export const useLoadTables = () => useQueryStore((s) => s.loadTables);
export const useSelectTable = () => useQueryStore((s) => s.selectTable);
export const useRefreshTable = () => useQueryStore((s) => s.refreshTable);
export const useClearResults = () => useQueryStore((s) => s.clearResults);
export const useClearQueryError = () => useQueryStore((s) => s.clearError);
export const useDatabases = () => useQueryStore((s) => s.databases);
export const useCurrentDatabase = () => useQueryStore((s) => s.currentDatabase);
export const useIsLoadingDatabases = () => useQueryStore((s) => s.isLoadingDatabases);
export const useLoadDatabases = () => useQueryStore((s) => s.loadDatabases);
export const useChangeDatabase = () => useQueryStore((s) => s.changeDatabase);
export const useResetDatabaseState = () => useQueryStore((s) => s.resetDatabaseState);
export const useInjectBenchmarkData = () => useQueryStore((s) => s.injectBenchmarkData);
