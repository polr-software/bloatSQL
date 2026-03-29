import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { tauriCommands } from '../../src/tauri/commands';
import { schemaStore } from '../../src/stores/schemaStore.store';

const originalListTables = tauriCommands.listTables;
const originalGetTableColumns = tauriCommands.getTableColumns;
const originalGetTableRelationships = tauriCommands.getTableRelationships;

function resetSchemaStore() {
  schemaStore.setState({
    cache: {},
    isLoadingSchema: false,
    error: null,
    loadingColumns: {},
  });
}

describe('schemaStore', () => {
  beforeEach(() => {
    resetSchemaStore();
  });

  afterEach(() => {
    tauriCommands.listTables = originalListTables;
    tauriCommands.getTableColumns = originalGetTableColumns;
    tauriCommands.getTableRelationships = originalGetTableRelationships;
    resetSchemaStore();
  });

  test('deduplicates parallel full schema loads', async () => {
    let listTablesCalls = 0;
    let getTableColumnsCalls = 0;
    let getRelationshipsCalls = 0;

    tauriCommands.listTables = async () => {
      listTablesCalls += 1;
      return ['users', 'posts'];
    };
    tauriCommands.getTableColumns = async (tableName: string) => {
      getTableColumnsCalls += 1;
      return [
        {
          name: `${tableName}_id`,
          dataType: 'int',
          isNullable: false,
          isPrimaryKey: true,
        },
      ];
    };
    tauriCommands.getTableRelationships = async () => {
      getRelationshipsCalls += 1;
      return [];
    };

    const [first, second] = await Promise.all([
      schemaStore.getState().loadFullSchema('conn-1:main'),
      schemaStore.getState().loadFullSchema('conn-1:main'),
    ]);

    expect(first).toEqual(second);
    expect(listTablesCalls).toBe(1);
    expect(getTableColumnsCalls).toBe(2);
    expect(getRelationshipsCalls).toBe(1);
    expect(schemaStore.getState().cache['conn-1:main']?.isFullyLoaded).toBe(true);
  });

  test('reuses cached table columns without refetch', async () => {
    schemaStore.setState({
      cache: {
        'conn-1:main': {
          tables: ['users'],
          columnsByTable: {
            users: [
              {
                name: 'id',
                dataType: 'int',
                isNullable: false,
                isPrimaryKey: true,
              },
            ],
          },
          relationships: [],
          isFullyLoaded: false,
        },
      },
      isLoadingSchema: false,
      error: null,
      loadingColumns: {},
    });

    let getTableColumnsCalls = 0;
    tauriCommands.getTableColumns = async () => {
      getTableColumnsCalls += 1;
      return [];
    };

    const columns = await schemaStore.getState().ensureTableColumns('conn-1:main', 'users');

    expect(columns).toEqual([
      {
        name: 'id',
        dataType: 'int',
        isNullable: false,
        isPrimaryKey: true,
      },
    ]);
    expect(getTableColumnsCalls).toBe(0);
  });

  test('invalidates only scoped cache and loading keys', () => {
    schemaStore.setState({
      cache: {
        'conn-1:main': {
          tables: ['users'],
          columnsByTable: {},
          relationships: [],
          isFullyLoaded: false,
        },
        'conn-2:other': {
          tables: ['posts'],
          columnsByTable: {},
          relationships: [],
          isFullyLoaded: false,
        },
      },
      isLoadingSchema: false,
      error: 'stale',
      loadingColumns: {
        'conn-1:main:users': true,
        'conn-2:other:posts': true,
      },
    });

    schemaStore.getState().invalidateSchema('conn-1:main');

    expect(schemaStore.getState().cache).toEqual({
      'conn-2:other': {
        tables: ['posts'],
        columnsByTable: {},
        relationships: [],
        isFullyLoaded: false,
      },
    });
    expect(schemaStore.getState().loadingColumns).toEqual({
      'conn-2:other:posts': true,
    });
    expect(schemaStore.getState().error).toBeNull();
  });
});
