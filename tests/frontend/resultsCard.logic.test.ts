import { describe, expect, test } from 'bun:test';
import {
  buildSelectedCellData,
  buildTruncatedResultsMessage,
  deleteRowsFromResults,
  resolveContextMenuTargetRows,
} from '../../src/components/QueryWorkspace/resultsCard.logic';

describe('resultsCard.logic', () => {
  test('builds selected-cell payload from results table context', () => {
    expect(
      buildSelectedCellData({
        rowIndex: 2,
        columnName: 'email',
        rowData: { id: 11, email: 'guest@example.com' },
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
      })
    ).toEqual({
      rowIndex: 2,
      columnName: 'email',
      focusedColumn: 'email',
      rowData: { id: 11, email: 'guest@example.com' },
      tableName: 'users',
      primaryKeyColumn: 'id',
      primaryKeyValue: 11,
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
    });
  });

  test('reuses multi-row selection only when the right-clicked row is selected', () => {
    const rowA = { id: 1 };
    const rowB = { id: 2 };
    const rowC = { id: 3 };
    const rows = [rowA, rowB, rowC];

    expect(
      resolveContextMenuTargetRows({
        contextMenuRowData: rowB,
        rowSelection: { 0: true, 1: true },
        rows,
      })
    ).toEqual([rowA, rowB]);

    expect(
      resolveContextMenuTargetRows({
        contextMenuRowData: rowC,
        rowSelection: { 0: true, 1: true },
        rows,
      })
    ).toEqual([rowC]);
  });

  test('formats truncated-results copy for the alert', () => {
    const expectedTruncatedCopy = `Showing the first ${(1000).toLocaleString()} rows out of ${(1200).toLocaleString()}.`;

    expect(
      buildTruncatedResultsMessage({
        columns: ['id'],
        rows: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 })),
        rowCount: 1200,
        executionTime: 12,
        truncated: true,
      })
    ).toBe(expectedTruncatedCopy);

    expect(
      buildTruncatedResultsMessage({
        columns: ['id'],
        rows: [],
        rowCount: 0,
        executionTime: 0,
        truncated: false,
      })
    ).toBeNull();
  });

  test('builds delete notifications for request-building failures and successful deletes', async () => {
    expect(
      await deleteRowsFromResults({
        loadedTable: 'users',
        tableColumns: [],
        targetRows: [{ id: 1 }],
        deleteRows: async () => {
          throw new Error('deleteRows should not run');
        },
        refreshTable: async () => {
          throw new Error('refreshTable should not run');
        },
      })
    ).toEqual({
      title: 'Cannot delete',
      message: 'No primary key column found for this table.',
      color: 'red',
    });

    expect(
      await deleteRowsFromResults({
        loadedTable: 'users',
        tableColumns: [
          {
            name: 'id',
            dataType: 'int',
            isNullable: false,
            isPrimaryKey: true,
          },
        ],
        targetRows: [{ id: 1 }, { id: 2 }],
        deleteRows: async () => ({
          success: true,
          deletedCount: 2,
        }),
        refreshTable: async () => {},
      })
    ).toEqual({
      title: 'Rows deleted',
      message: 'Deleted 2 rows',
      color: 'green',
    });
  });
});
