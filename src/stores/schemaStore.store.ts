import { createStore } from 'zustand/vanilla';
import { tauriCommands } from '../tauri/commands';
import { TableColumn, TableRelationship } from '../types/database';

export interface SchemaCacheEntry {
  tables: string[];
  columnsByTable: Record<string, TableColumn[]>;
  relationships: TableRelationship[];
  isFullyLoaded: boolean;
}

export interface SchemaState {
  cache: Record<string, SchemaCacheEntry>;
  isLoadingSchema: boolean;
  error: string | null;
  loadingColumns: Record<string, boolean>;
}

export interface SchemaActions {
  loadFullSchema: (cacheKey: string) => Promise<SchemaCacheEntry>;
  ensureTableColumns: (cacheKey: string, tableName: string) => Promise<TableColumn[]>;
  invalidateSchema: (cacheKey?: string) => void;
  clearError: () => void;
}

export type SchemaStore = SchemaState & SchemaActions;

const fullSchemaRequests = new Map<string, Promise<SchemaCacheEntry>>();
const columnRequests = new Map<string, Promise<TableColumn[]>>();

const emptyEntry = (): SchemaCacheEntry => ({
  tables: [],
  columnsByTable: {},
  relationships: [],
  isFullyLoaded: false,
});

function parseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown schema error';
}

function getColumnLoadingKey(cacheKey: string, tableName: string): string {
  return `${cacheKey}:${tableName}`;
}

export function getSchemaCacheKey(
  connectionId: string | null | undefined,
  databaseName: string | null | undefined
): string | null {
  if (!connectionId || !databaseName) return null;
  return `${connectionId}:${databaseName}`;
}

export const schemaStore = createStore<SchemaStore>((set, get) => ({
  cache: {},
  isLoadingSchema: false,
  error: null,
  loadingColumns: {},

  loadFullSchema: async (cacheKey) => {
    const cached = get().cache[cacheKey];
    if (cached?.isFullyLoaded) {
      return cached;
    }

    const pendingRequest = fullSchemaRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    set({ isLoadingSchema: true, error: null });

    const request = (async () => {
      const tables = await tauriCommands.listTables();
      const [columnsEntries, relationships] = await Promise.all([
        Promise.all(
          tables.map(async (tableName) => {
            const columns = await tauriCommands.getTableColumns(tableName);
            return [tableName, columns] as const;
          })
        ),
        tauriCommands.getTableRelationships(),
      ]);

      const entry: SchemaCacheEntry = {
        tables,
        columnsByTable: Object.fromEntries(columnsEntries),
        relationships,
        isFullyLoaded: true,
      };

      set((state) => ({
        cache: {
          ...state.cache,
          [cacheKey]: entry,
        },
        isLoadingSchema: false,
      }));

      return entry;
    })();

    fullSchemaRequests.set(cacheKey, request);

    try {
      return await request;
    } catch (error) {
      set({
        error: parseError(error),
        isLoadingSchema: false,
      });
      throw error;
    } finally {
      fullSchemaRequests.delete(cacheKey);
    }
  },

  ensureTableColumns: async (cacheKey, tableName) => {
    const cached = get().cache[cacheKey];
    const existingColumns = cached?.columnsByTable[tableName];
    if (existingColumns) {
      return existingColumns;
    }

    const loadingKey = getColumnLoadingKey(cacheKey, tableName);
    const pendingRequest = columnRequests.get(loadingKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    set((state) => ({
      loadingColumns: {
        ...state.loadingColumns,
        [loadingKey]: true,
      },
      error: null,
    }));

    const request = (async () => {
      const columns = await tauriCommands.getTableColumns(tableName);

      set((state) => {
        const nextEntry = state.cache[cacheKey] ?? emptyEntry();
        return {
          cache: {
            ...state.cache,
            [cacheKey]: {
              ...nextEntry,
              columnsByTable: {
                ...nextEntry.columnsByTable,
                [tableName]: columns,
              },
            },
          },
          loadingColumns: {
            ...state.loadingColumns,
            [loadingKey]: false,
          },
        };
      });

      return columns;
    })();

    columnRequests.set(loadingKey, request);

    try {
      return await request;
    } catch (error) {
      set((state) => ({
        error: parseError(error),
        loadingColumns: {
          ...state.loadingColumns,
          [loadingKey]: false,
        },
      }));
      throw error;
    } finally {
      columnRequests.delete(loadingKey);
    }
  },

  invalidateSchema: (cacheKey) => {
    if (!cacheKey) {
      set({ cache: {}, loadingColumns: {}, error: null });
      return;
    }

    set((state) => {
      const nextCache = { ...state.cache };
      delete nextCache[cacheKey];

      const nextLoadingColumns = Object.fromEntries(
        Object.entries(state.loadingColumns).filter(([key]) => !key.startsWith(`${cacheKey}:`))
      );

      return {
        cache: nextCache,
        loadingColumns: nextLoadingColumns,
        error: null,
      };
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
