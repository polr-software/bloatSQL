import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  Text,
  Loader,
  Center,
  Alert,
  Box,
  Menu,
} from '@mantine/core';
import { IconAlertCircle, IconDownload, IconInfoCircle, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { type ColumnDef, type Row, type RowSelectionState, type OnChangeFn } from '@tanstack/react-table';
import { QueryResult } from '../../types/database';
import { useSelectCell, useSelectedCell } from '../../stores/editCellStore';
import {
  useLoadedTable,
  useTableColumns,
  useRefreshTable,
} from '../../stores/queryExecutionStore';
import { tauriCommands } from '../../tauri/commands';
import { useRowSelectionStore } from '../../stores/rowSelectionStore';
import { DataTable } from '../common/DataTable';
import {
  buildSelectedCellData,
  buildTruncatedResultsMessage,
  deleteRowsFromResults,
  resolveContextMenuTargetRows,
} from './resultsCard.logic';
import styles from './ResultsCard.module.css';

interface ResultsCardProps {
  results: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
  onClearError: () => void;
  onOpenExportModal?: (rowData?: Record<string, unknown> | Record<string, unknown>[]) => void;
}

function formatCellValue(value: unknown): string {
  if (value === null) return 'NULL';
  if (value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// Sub-komponent czytający selectedCell bezpośrednio ze store –
// unika uwzględniania selectedCell w deps kolumn i nie powoduje
// ich przebudowy przy każdym kliknięciu komórki.
interface ResultCellProps {
  rowIndex: number;
  columnName: string;
  value: unknown;
  rowData: Record<string, unknown>;
  onCellClick: (rowIndex: number, columnName: string, rowData: Record<string, unknown>) => void;
}

function ResultCell({ rowIndex, columnName, value, rowData, onCellClick }: ResultCellProps) {
  const selectedCell = useSelectedCell();
  const isFocused =
    selectedCell?.rowIndex === rowIndex && selectedCell?.columnName === columnName;

  return (
    <div
      className={`${styles.cellClickable} ${isFocused ? styles.cellFocused : ''}`}
      onClick={() => onCellClick(rowIndex, columnName, rowData)}
    >
      {formatCellValue(value)}
    </div>
  );
}

export function ResultsCard({
  results,
  isExecuting,
  error,
  onClearError,
  onOpenExportModal,
}: ResultsCardProps) {
  const selectCell = useSelectCell();
  const loadedTable = useLoadedTable();
  const tableColumns = useTableColumns();
  const refreshTable = useRefreshTable();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowData: Record<string, unknown>;
  } | null>(null);

  const rows = useMemo(() => results?.rows ?? [], [results]);

  // Reset selection when query results change.
  useEffect(() => {
    setRowSelection({});
  }, [results]);

  // Sync selected rows + clear function to store so Footer can read them.
  useEffect(() => {
    const selectedRowData = Object.keys(rowSelection)
      .filter((id) => rowSelection[id])
      .map((id) => rows[parseInt(id)])
      .filter(Boolean) as Record<string, unknown>[];
    useRowSelectionStore.getState().setSelection(selectedRowData, () => setRowSelection({}));
  }, [rowSelection, rows]);

  // Register export callback in store; clean up on unmount.
  useEffect(() => {
    useRowSelectionStore.getState().setExportFn(
      onOpenExportModal ? (selectedRows) => onOpenExportModal(selectedRows) : null
    );
    return () => {
      useRowSelectionStore.getState().reset();
    };
  }, [onOpenExportModal]);

  const handleRowSelectionChange = useCallback<OnChangeFn<RowSelectionState>>(
    (updaterOrValue) =>
      setRowSelection((prev) =>
        typeof updaterOrValue === 'function' ? updaterOrValue(prev) : updaterOrValue
      ),
    []
  );

  const handleCellClick = useCallback(
    (rowIndex: number, columnName: string, rowData: Record<string, unknown>) => {
      selectCell(
        buildSelectedCellData({
          rowIndex,
          columnName,
          rowData,
          loadedTable,
          tableColumns,
        })
      );
    },
    [tableColumns, selectCell, loadedTable]
  );

  const columns = useMemo<ColumnDef<Record<string, unknown>, unknown>[]>(() => {
    return (results?.columns ?? []).map((col) => ({
      id: col,
      accessorFn: (row) => row[col],
      header: col,
      cell: ({ row, getValue }) => (
        <ResultCell
          rowIndex={row.index}
          columnName={col}
          value={getValue()}
          rowData={row.original}
          onCellClick={handleCellClick}
        />
      ),
    }));
  }, [results?.columns, handleCellClick]);

  const getRowProps = useCallback(
    (row: Row<Record<string, unknown>>) => ({
      onContextMenu: (e: React.MouseEvent<HTMLTableRowElement>) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, rowData: row.original });
      },
    }),
    []
  );

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  // Rows that the context menu actions will target.
  // If the right-clicked row is part of a multi-row selection, all selected rows are targeted.
  const contextMenuTargetRows = useMemo(() => {
    return resolveContextMenuTargetRows({
      contextMenuRowData: contextMenu?.rowData ?? null,
      rowSelection,
      rows,
    });
  }, [contextMenu, rowSelection, rows]);

  const handleExportRow = useCallback(() => {
    if (contextMenu === null || !onOpenExportModal) return;
    onOpenExportModal(contextMenuTargetRows.length > 1 ? contextMenuTargetRows : contextMenu.rowData);
    handleCloseContextMenu();
  }, [contextMenu, contextMenuTargetRows, onOpenExportModal, handleCloseContextMenu]);

  const handleDeleteRow = useCallback(async () => {
    if (contextMenu === null || !loadedTable) return;

    handleCloseContextMenu();

    const notification = await deleteRowsFromResults({
      loadedTable,
      tableColumns,
      targetRows: contextMenuTargetRows,
      deleteRows: tauriCommands.deleteRows,
      refreshTable,
    });

    notifications.show(notification);
  }, [contextMenu, contextMenuTargetRows, loadedTable, tableColumns, handleCloseContextMenu, refreshTable]);

  const truncatedMessage = buildTruncatedResultsMessage(results);

  return (
    <Box h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Query Error"
          color="red"
          mb="md"
          withCloseButton
          onClose={onClearError}
        >
          {error}
        </Alert>
      )}

      {truncatedMessage && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          title="Results truncated"
          color="yellow"
          mb="md"
        >
          {truncatedMessage}
        </Alert>
      )}

      {!results ? (
        <Center h={200}>
          {isExecuting ? (
            <Loader />
          ) : (
            <Text c="dimmed">Execute a query to see results</Text>
          )}
        </Center>
      ) : rows.length === 0 ? (
        <Center h={200}>
          <Text c="dimmed">No data returned</Text>
        </Center>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          striped
          highlightOnHover
          withColumnBorders
          enableSorting
          enableRowSelection
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
          getRowProps={getRowProps}
          className={`${styles.resultsTable} ${isExecuting ? styles.resultsTableExecuting : ''}`}
          estimatedRowHeight={36}
        />
      )}

      <Menu
        opened={contextMenu !== null}
        onClose={handleCloseContextMenu}
        position="bottom-start"
        withinPortal
      >
        <Menu.Target>
          <div
            style={{
              position: 'fixed',
              left: contextMenu?.x ?? 0,
              top: contextMenu?.y ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconDownload size={16} />}
            onClick={handleExportRow}
          >
            {contextMenuTargetRows.length > 1
              ? `Export ${contextMenuTargetRows.length} rows`
              : 'Export row'}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconTrash size={16} />}
            color="red"
            onClick={handleDeleteRow}
          >
            {contextMenuTargetRows.length > 1
              ? `Delete ${contextMenuTargetRows.length} rows`
              : 'Delete row'}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Box>
  );
}
