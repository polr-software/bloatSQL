import { getSchemaCacheKey } from '../stores/schemaStore.store';

interface SyncSchemaMutationFlowParams {
  tableName: string;
  activeConnectionId: string | null | undefined;
  currentDatabase: string | null | undefined;
  loadedTable: string | null | undefined;
  invalidateSchema: (cacheKey?: string) => void;
  loadTables: () => Promise<void>;
  refreshTable: () => Promise<void>;
}

export async function syncSchemaMutationFlow({
  tableName,
  activeConnectionId,
  currentDatabase,
  loadedTable,
  invalidateSchema,
  loadTables,
  refreshTable,
}: SyncSchemaMutationFlowParams): Promise<void> {
  const cacheKey = getSchemaCacheKey(activeConnectionId, currentDatabase);
  if (cacheKey) {
    invalidateSchema(cacheKey);
  }

  await loadTables();

  if (loadedTable === tableName) {
    await refreshTable();
  }
}
