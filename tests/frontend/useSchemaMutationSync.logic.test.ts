import { describe, expect, test } from 'bun:test';
import { syncSchemaMutationFlow } from '../../src/hooks/useSchemaMutationSync.logic';

describe('syncSchemaMutationFlow', () => {
  test('invalidates cache and refreshes loaded table after schema mutation', async () => {
    const calls: string[] = [];

    await syncSchemaMutationFlow({
      tableName: 'users',
      activeConnectionId: 'conn-1',
      currentDatabase: 'main',
      loadedTable: 'users',
      invalidateSchema: (cacheKey) => {
        calls.push(`invalidate:${cacheKey}`);
      },
      loadTables: async () => {
        calls.push('loadTables');
      },
      refreshTable: async () => {
        calls.push('refreshTable');
      },
    });

    expect(calls).toEqual([
      'invalidate:conn-1:main',
      'loadTables',
      'refreshTable',
    ]);
  });

  test('skips refresh when mutated table is not currently loaded', async () => {
    const calls: string[] = [];

    await syncSchemaMutationFlow({
      tableName: 'users',
      activeConnectionId: 'conn-1',
      currentDatabase: 'main',
      loadedTable: 'posts',
      invalidateSchema: (cacheKey) => {
        calls.push(`invalidate:${cacheKey}`);
      },
      loadTables: async () => {
        calls.push('loadTables');
      },
      refreshTable: async () => {
        calls.push('refreshTable');
      },
    });

    expect(calls).toEqual(['invalidate:conn-1:main', 'loadTables']);
  });

  test('does not invalidate schema when cache key cannot be built', async () => {
    const calls: string[] = [];

    await syncSchemaMutationFlow({
      tableName: 'users',
      activeConnectionId: null,
      currentDatabase: 'main',
      loadedTable: 'users',
      invalidateSchema: () => {
        calls.push('invalidate');
      },
      loadTables: async () => {
        calls.push('loadTables');
      },
      refreshTable: async () => {
        calls.push('refreshTable');
      },
    });

    expect(calls).toEqual(['loadTables', 'refreshTable']);
  });
});
