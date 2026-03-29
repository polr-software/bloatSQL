import { useCallback } from 'react';
import { useActiveConnection } from '../stores/connectionStore';
import { useCurrentDatabase, useLoadTables } from '../stores/databaseBrowserStore';
import { useLoadedTable, useRefreshTable } from '../stores/queryExecutionStore';
import { useSchemaStore } from '../stores/schemaStore';
import { syncSchemaMutationFlow } from './useSchemaMutationSync.logic';

export function useSchemaMutationSync() {
  const activeConnection = useActiveConnection();
  const currentDatabase = useCurrentDatabase();
  const loadedTable = useLoadedTable();
  const refreshTable = useRefreshTable();
  const loadTables = useLoadTables();
  const invalidateSchema = useSchemaStore((s) => s.invalidateSchema);

  return useCallback(
    async (tableName: string) => {
      await syncSchemaMutationFlow({
        tableName,
        activeConnectionId: activeConnection?.id,
        currentDatabase,
        loadedTable,
        invalidateSchema,
        loadTables,
        refreshTable,
      });
    },
    [
      activeConnection?.id,
      currentDatabase,
      invalidateSchema,
      loadTables,
      loadedTable,
      refreshTable,
    ]
  );
}
