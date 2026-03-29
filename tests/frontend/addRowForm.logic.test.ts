import { describe, expect, test } from 'bun:test';
import {
  buildAddRowInitialValues,
  canAddRowColumnBeNull,
  getAddRowDescription,
  getAddRowPlaceholder,
  isAddRowColumnRequired,
  submitAddRowForm,
  validateAddRowValues,
} from '../../src/components/CellEditor/addRowForm.logic';

describe('addRowForm.logic', () => {
  test('builds initial values and validates only required columns', () => {
    const columns = [
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
        name: 'nickname',
        dataType: 'varchar',
        isNullable: false,
        isPrimaryKey: false,
        columnDefault: 'guest',
      },
      {
        name: 'bio',
        dataType: 'text',
        isNullable: true,
        isPrimaryKey: false,
      },
    ];

    expect(buildAddRowInitialValues(columns)).toEqual({
      id: '',
      email: '',
      nickname: '',
      bio: '',
    });

    expect(isAddRowColumnRequired(columns[0])).toBe(false);
    expect(isAddRowColumnRequired(columns[1])).toBe(true);
    expect(isAddRowColumnRequired(columns[2])).toBe(false);
    expect(isAddRowColumnRequired(columns[3])).toBe(false);
    expect(canAddRowColumnBeNull(columns[1])).toBe(false);
    expect(canAddRowColumnBeNull(columns[3])).toBe(true);

    expect(
      validateAddRowValues(columns, {
        id: '',
        email: '   ',
        nickname: '',
        bio: '',
      })
    ).toEqual({
      email: 'To pole jest wymagane',
    });

    expect(
      validateAddRowValues(
        columns,
        {
          id: '',
          email: 'guest@example.com',
          nickname: '',
          bio: '',
        },
        {
          bio: true,
        }
      )
    ).toEqual({});
  });

  test('builds user-facing placeholders for add-row inputs', () => {
    expect(
      getAddRowPlaceholder({
        name: 'nickname',
        dataType: 'varchar',
        isNullable: false,
        isPrimaryKey: false,
        columnDefault: 'guest',
      })
    ).toBe('Default: guest');

    expect(
      getAddRowPlaceholder({
        name: 'id',
        dataType: 'int',
        isNullable: false,
        isPrimaryKey: true,
      })
    ).toBe('Leave empty for DEFAULT');

    expect(
      getAddRowPlaceholder({
        name: 'bio',
        dataType: 'text',
        isNullable: true,
        isPrimaryKey: false,
      })
    ).toBe('Leave empty for DEFAULT');

    expect(
      getAddRowDescription(
        {
          name: 'bio',
          dataType: 'text',
          isNullable: true,
          isPrimaryKey: false,
        },
        false
      )
    ).toBe('Leave empty to use database DEFAULT. Use NULL to force SQL NULL.');

    expect(
      getAddRowDescription(
        {
          name: 'bio',
          dataType: 'text',
          isNullable: true,
          isPrimaryKey: false,
        },
        true
      )
    ).toBe('This column will be inserted as SQL NULL.');
  });

  test('submits add-row values through the form wiring', async () => {
    const calls: string[] = [];

    const result = await submitAddRowForm({
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
      ],
      values: {
        id: '',
        email: 'guest@example.com',
      },
      nullColumns: {},
      addRow: async (request) => {
        calls.push(JSON.stringify(request));
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

    expect(calls).toEqual([
      JSON.stringify({
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
        ],
      }),
      'refreshTable',
    ]);

    expect(result).toEqual({
      insertedCount: 1,
      successMessage: 'Inserted 1 row',
      executedQuery: "INSERT INTO users (email) VALUES ('guest@example.com')",
    });
  });

  test('submits explicit SQL NULL for nullable columns', async () => {
    const calls: string[] = [];

    const result = await submitAddRowForm({
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
      addRow: async (request) => {
        calls.push(JSON.stringify(request));
        return {
          success: true,
          insertedCount: 1,
          executedQuery: 'INSERT INTO users (bio) VALUES (NULL)',
        };
      },
      refreshTable: async () => {
        calls.push('refreshTable');
      },
    });

    expect(calls).toEqual([
      JSON.stringify({
        tableName: 'users',
        values: [
          {
            columnName: 'bio',
            value: null,
            useDefault: false,
          },
        ],
      }),
      'refreshTable',
    ]);

    expect(result).toEqual({
      insertedCount: 1,
      successMessage: 'Inserted 1 row',
      executedQuery: 'INSERT INTO users (bio) VALUES (NULL)',
    });
  });
});
