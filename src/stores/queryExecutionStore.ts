import { create } from 'zustand';
import { useConnectionStore } from '../connections';
import { tauriCommands } from '../tauri/commands';
import { QueryResult, TableColumn } from '../types/database';
import { useConsoleLogStore } from './consoleLogStore';
import { useEditCellStore } from './editCellStore';
import { useQueryEditorStore } from './queryEditorStore';
import {
  formatTableName,
  parseQueryStoreError,
  QUERY_TIMEOUT_MS,
  withTimeout,
} from './queryStore.utils';

interface QueryExecutionState {
  results: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
  lastExecutionTime: number | null;
  loadedTable: string | null;
  tableColumns: TableColumn[];
}

interface QueryExecutionActions {
  executeQuery: () => Promise<void>;
  executeQueryText: (text: string) => Promise<void>;
  selectTable: (tableName: string) => Promise<void>;
  refreshTable: () => Promise<void>;
  clearResults: () => void;
  clearError: () => void;
  injectBenchmarkData: (rowCount: number) => void;
  resetExecutionContext: () => void;
}

type QueryExecutionStore = QueryExecutionState & QueryExecutionActions;

export const useQueryExecutionStore = create<QueryExecutionStore>((set, get) => ({
  results: null,
  isExecuting: false,
  error: null,
  lastExecutionTime: null,
  loadedTable: null,
  tableColumns: [],

  executeQuery: async () => {
    const { queryText } = useQueryEditorStore.getState();
    if (!queryText.trim()) {
      set({ error: 'Query is empty' });
      return;
    }

    set({ isExecuting: true, error: null });
    useConsoleLogStore.getState().addLog(queryText);

    try {
      const results = await withTimeout(
        tauriCommands.executeQuery(queryText),
        QUERY_TIMEOUT_MS
      );

      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
        loadedTable: null,
        tableColumns: [],
      });
    } catch (error) {
      set({
        error: parseQueryStoreError(error),
        isExecuting: false,
      });
    }
  },

  executeQueryText: async (text) => {
    if (!text.trim()) return;

    set({ isExecuting: true, error: null });
    useConsoleLogStore.getState().addLog(text);

    try {
      const results = await withTimeout(
        tauriCommands.executeQuery(text),
        QUERY_TIMEOUT_MS
      );

      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
        loadedTable: null,
        tableColumns: [],
      });
    } catch (error) {
      set({
        error: parseQueryStoreError(error),
        isExecuting: false,
      });
    }
  },

  selectTable: async (tableName) => {
    const { loadedTable } = get();
    if (loadedTable === tableName) {
      return;
    }

    useEditCellStore.getState().clearSelection();

    const activeConnection = useConnectionStore.getState().activeConnection;
    const formattedTableName = formatTableName(tableName, activeConnection?.dbType);
    const query = `SELECT * FROM ${formattedTableName}`;

    useQueryEditorStore.getState().setQueryText(query);
    set({
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
        error: parseQueryStoreError(error),
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
      const [results, columns] = await Promise.all([
        withTimeout(tauriCommands.executeQuery(query), QUERY_TIMEOUT_MS),
        tauriCommands.getTableColumns(loadedTable),
      ]);

      set({
        results,
        isExecuting: false,
        lastExecutionTime: results.executionTime,
        tableColumns: columns,
      });
    } catch (error) {
      set({
        error: parseQueryStoreError(error),
        isExecuting: false,
      });
    }
  },

  clearResults: () => {
    set({
      results: null,
      error: null,
      lastExecutionTime: null,
      loadedTable: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },

  injectBenchmarkData: (rowCount) => {
    const columns = [
      'id',
      'name',
      'email',
      'city',
      'country',
      'status',
      'score',
      'created_at',
      'balance',
      'is_active',
    ];
    const statuses = ['active', 'inactive', 'pending', 'banned'];
    const cities = [
      'Warsaw',
      'Krakow',
      'Gdansk',
      'Wroclaw',
      'Poznan',
      'Berlin',
      'Prague',
      'Vienna',
    ];
    const countries = ['Poland', 'Germany', 'Czech Republic', 'Austria'];

    const rows: Record<string, unknown>[] = Array.from(
      { length: rowCount },
      (_, i) => ({
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
      })
    );

    set({
      results: {
        columns,
        rows,
        rowCount,
        executionTime: 0,
        truncated: false,
      },
      isExecuting: false,
      error: null,
      loadedTable: null,
      tableColumns: [],
    });
  },

  resetExecutionContext: () => {
    set({
      results: null,
      loadedTable: null,
      tableColumns: [],
    });
  },
}));

export const useQueryResults = () => useQueryExecutionStore((s) => s.results);
export const useIsExecuting = () => useQueryExecutionStore((s) => s.isExecuting);
export const useQueryError = () => useQueryExecutionStore((s) => s.error);
export const useLastExecutionTime = () =>
  useQueryExecutionStore((s) => s.lastExecutionTime);
export const useLoadedTable = () => useQueryExecutionStore((s) => s.loadedTable);
export const useTableColumns = () => useQueryExecutionStore((s) => s.tableColumns);
export const useExecuteQuery = () => useQueryExecutionStore((s) => s.executeQuery);
export const useExecuteQueryText = () =>
  useQueryExecutionStore((s) => s.executeQueryText);
export const useSelectTable = () => useQueryExecutionStore((s) => s.selectTable);
export const useRefreshTable = () => useQueryExecutionStore((s) => s.refreshTable);
export const useClearResults = () => useQueryExecutionStore((s) => s.clearResults);
export const useClearQueryError = () => useQueryExecutionStore((s) => s.clearError);
export const useInjectBenchmarkData = () =>
  useQueryExecutionStore((s) => s.injectBenchmarkData);
