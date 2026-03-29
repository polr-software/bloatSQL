import { describe, expect, test } from 'bun:test';
import {
  buildCellEditInitialValues,
  buildChangedCellRequests,
  formatCellInputValue,
  getCellEditValidationError,
  isMultilineCellValue,
  submitChangedCellRequests,
} from '../../src/components/CellEditor/cellEditForm.logic';
import { CellEditData } from '../../src/stores/editCellStore';

const selectedCell: CellEditData = {
  rowIndex: 0,
  columnName: 'name',
  focusedColumn: 'name',
  rowData: {
    id: 7,
    name: 'Alice',
    notes: null,
    metadata: { active: true },
  },
  tableName: 'users',
  primaryKeyColumn: 'id',
  primaryKeyValue: 7,
};

describe('cellEditForm.logic', () => {
  test('formats initial form values for editable cells', () => {
    expect(formatCellInputValue(null)).toBe('');
    expect(formatCellInputValue(undefined)).toBe('');
    expect(formatCellInputValue(false)).toBe('false');
    expect(formatCellInputValue({ active: true })).toBe('{"active":true}');

    expect(buildCellEditInitialValues(selectedCell)).toEqual({
      id: '7',
      name: 'Alice',
      notes: '',
      metadata: '{"active":true}',
    });
  });

  test('detects multiline values and validates required table metadata', () => {
    expect(isMultilineCellValue('short line')).toBe(false);
    expect(isMultilineCellValue('line 1\nline 2')).toBe(true);
    expect(isMultilineCellValue('x'.repeat(101))).toBe(true);

    expect(getCellEditValidationError(null)).toBe('Cannot update: table name not available');
    expect(
      getCellEditValidationError({
        ...selectedCell,
        primaryKeyColumn: undefined,
        primaryKeyValue: undefined,
      })
    ).toBe('Cannot update: primary key not found. Updates require a primary key.');
  });

  test('builds update requests only for changed known columns', () => {
    expect(
      buildChangedCellRequests(selectedCell, {
        id: '7',
        name: 'Bob',
        notes: '',
        metadata: '{"active":false}',
        ignored: 'value',
      })
    ).toEqual([
      {
        tableName: 'users',
        columnName: 'name',
        newValue: 'Bob',
        primaryKeyColumn: 'id',
        primaryKeyValue: '7',
      },
      {
        tableName: 'users',
        columnName: 'metadata',
        newValue: '{"active":false}',
        primaryKeyColumn: 'id',
        primaryKeyValue: '7',
      },
    ]);
  });

  test('submits changed cell requests, logs executed queries and refreshes once', async () => {
    const logs: string[] = [];
    const calls: string[] = [];

    const result = await submitChangedCellRequests({
      requests: [
        {
          tableName: 'users',
          columnName: 'name',
          newValue: 'Bob',
          primaryKeyColumn: 'id',
          primaryKeyValue: '7',
        },
        {
          tableName: 'users',
          columnName: 'notes',
          newValue: null,
          primaryKeyColumn: 'id',
          primaryKeyValue: '7',
        },
      ],
      updateCell: async (request) => {
        calls.push(request.columnName);
        return {
          success: true,
          executedQuery: `UPDATE users SET ${request.columnName}`,
        };
      },
      refreshTable: async () => {
        calls.push('refresh');
      },
      addConsoleLog: (entry) => {
        logs.push(entry);
      },
    });

    expect(calls).toEqual(['name', 'notes', 'refresh']);
    expect(logs).toEqual(['UPDATE users SET name', 'UPDATE users SET notes']);
    expect(result).toEqual({
      updatedColumns: ['name', 'notes'],
      executedQueries: ['UPDATE users SET name', 'UPDATE users SET notes'],
    });
  });

  test('formats backend failures with component-level update context', async () => {
    const flow = submitChangedCellRequests({
      requests: [
        {
          tableName: 'users',
          columnName: 'name',
          newValue: 'Bob',
          primaryKeyColumn: 'id',
          primaryKeyValue: '7',
        },
      ],
      updateCell: async () => ({
        success: false,
        error: {
          message: 'Update failed',
          code: '23505',
          detail: 'duplicate key value violates unique constraint',
          table: 'users',
          column: 'name',
        },
      }),
      refreshTable: async () => {
        throw new Error('refreshTable should not run');
      },
      addConsoleLog: () => {},
    });

    await expect(flow).rejects.toThrow(
      'Failed to update cell: Update failed\nDetail: duplicate key value violates unique constraint\n(Error code: 23505)'
    );
  });
});
