import { describe, expect, test } from 'bun:test';
import { addRowFlow, buildAddRowRequest } from '../../src/components/CellEditor/addRowFlow';

describe('addRowFlow', () => {
  test('builds add-row request from table columns and form values', () => {
    const request = buildAddRowRequest({
      tableName: 'users',
      columns: [
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
        {
          name: 'bio',
          dataType: 'text',
          isNullable: true,
          isPrimaryKey: false,
        },
      ],
      values: {
        id: '',
        email: 'guest@example.com',
        bio: '',
      },
    });

    expect(request).toEqual({
      tableName: 'users',
      values: [
        {
          columnName: 'id',
          value: null,
          useDefault: true,
        },
        {
          columnName: 'email',
          value: 'guest@example.com',
          useDefault: false,
        },
        {
          columnName: 'bio',
          value: null,
          useDefault: true,
        },
      ],
    });
  });

  test('builds explicit SQL NULL for nullable columns selected in null mode', () => {
    const request = buildAddRowRequest({
      tableName: 'users',
      columns: [
        {
          name: 'bio',
          dataType: 'text',
          isNullable: true,
          isPrimaryKey: false,
        },
      ],
      values: {
        bio: '',
      },
      nullColumns: {
        bio: true,
      },
    });

    expect(request).toEqual({
      tableName: 'users',
      values: [
        {
          columnName: 'bio',
          value: null,
          useDefault: false,
        },
      ],
    });
  });

  test('throws when there is no active table', () => {
    expect(() =>
      buildAddRowRequest({
        tableName: null,
        columns: [],
        values: {},
      })
    ).toThrow('No table selected.');
  });

  test('inserts row, refreshes table and returns result details', async () => {
    const calls: string[] = [];

    const result = await addRowFlow({
      request: {
        tableName: 'users',
        values: [
          {
            columnName: 'email',
            value: 'guest@example.com',
            useDefault: false,
          },
        ],
      },
      addRow: async () => {
        calls.push('addRow');
        return {
          success: true,
          insertedCount: 1,
          executedQuery: "INSERT INTO users (email) VALUES ('guest@example.com')",
        };
      },
      refreshTable: async () => {
        calls.push('refreshTable');
      },
    });

    expect(calls).toEqual(['addRow', 'refreshTable']);
    expect(result).toEqual({
      insertedCount: 1,
      successMessage: 'Inserted 1 row',
      executedQuery: "INSERT INTO users (email) VALUES ('guest@example.com')",
    });
  });

  test('throws formatted backend error when insert fails', async () => {
    const flow = addRowFlow({
      request: {
        tableName: 'users',
        values: [
          {
            columnName: 'email',
            value: 'guest@example.com',
            useDefault: false,
          },
        ],
      },
      addRow: async () => ({
        success: false,
        insertedCount: 0,
        error: {
          message: 'Insert failed',
          code: '23502',
          detail: 'Null value in column "email" violates not-null constraint',
          table: 'users',
        },
      }),
      refreshTable: async () => {
        throw new Error('refreshTable should not run');
      },
    });

    await expect(flow).rejects.toThrow(
      'Insert failed\nDetail: Null value in column "email" violates not-null constraint\n(Error code: 23502)'
    );
  });
});
