import { describe, expect, test } from 'bun:test';
import {
  buildDeleteRowsRequest,
  deleteRowsFlow,
} from '../../src/components/QueryWorkspace/deleteRowsFlow';

describe('deleteRowsFlow', () => {
  test('builds delete request from selected rows and primary key metadata', () => {
    const request = buildDeleteRowsRequest({
      loadedTable: 'users',
      tableColumns: [
        {
          name: 'id',
          dataType: 'int',
          isNullable: false,
          isPrimaryKey: true,
        },
        {
          name: 'email',
          dataType: 'varchar',
          isNullable: false,
          isPrimaryKey: false,
        },
      ],
      targetRows: [
        { id: 1, email: 'a@example.com' },
        { id: 2, email: 'b@example.com' },
      ],
    });

    expect(request).toEqual({
      tableName: 'users',
      primaryKeyColumn: 'id',
      primaryKeyValues: ['1', '2'],
    });
  });

  test('throws when table has no primary key', () => {
    expect(() =>
      buildDeleteRowsRequest({
        loadedTable: 'users',
        tableColumns: [
          {
            name: 'email',
            dataType: 'varchar',
            isNullable: false,
            isPrimaryKey: false,
          },
        ],
        targetRows: [{ email: 'a@example.com' }],
      })
    ).toThrow('No primary key column found for this table.');
  });

  test('deletes rows, refreshes table and returns success message', async () => {
    const calls: string[] = [];

    const result = await deleteRowsFlow({
      request: {
        tableName: 'users',
        primaryKeyColumn: 'id',
        primaryKeyValues: ['1', '2'],
      },
      deleteRows: async () => {
        calls.push('deleteRows');
        return {
          success: true,
          deletedCount: 2,
          executedQuery: 'DELETE FROM users WHERE id IN (1, 2)',
        };
      },
      refreshTable: async () => {
        calls.push('refreshTable');
      },
    });

    expect(calls).toEqual(['deleteRows', 'refreshTable']);
    expect(result).toEqual({
      deletedCount: 2,
      successMessage: 'Deleted 2 rows',
    });
  });

  test('throws formatted backend error when deletion fails', async () => {
    const flow = deleteRowsFlow({
      request: {
        tableName: 'users',
        primaryKeyColumn: 'id',
        primaryKeyValues: ['1'],
      },
      deleteRows: async () => ({
        success: false,
        deletedCount: 0,
        error: {
          message: 'Delete failed',
          code: '23503',
          hint: 'Row is still referenced by another table',
          table: 'users',
          primaryKeyColumn: 'id',
        },
      }),
      refreshTable: async () => {
        throw new Error('refreshTable should not run');
      },
    });

    await expect(flow).rejects.toThrow(
      'Delete failed\nHint: Row is still referenced by another table\n(Error code: 23503)'
    );
  });
});
