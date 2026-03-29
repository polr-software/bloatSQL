import { useRef, useState, CSSProperties, useMemo } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type Row,
  type SortingState,
  type OnChangeFn,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Table, Checkbox, Group, Text, Button } from '@mantine/core';
import { IconChevronUp, IconChevronDown, IconSelector } from '@tabler/icons-react';
import styles from './DataTable.module.css';

export type { Cell, ColumnDef, Row, SortingState, OnChangeFn, RowSelectionState };

export interface RowProps {
  style?: CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
}

export interface CellProps {
  style?: CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}

export interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  striped?: boolean;
  highlightOnHover?: boolean;
  withColumnBorders?: boolean;
  /** Applied to the outermost element (scroll container or selection wrapper). */
  className?: string;
  style?: CSSProperties;
  getRowProps?: (row: Row<TData>) => RowProps;
  getCellProps?: (cell: Cell<TData, unknown>) => CellProps;
  enableSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  estimatedRowHeight?: number;
  overscan?: number;
  // ── Row selection ──────────────────────────────────────────────────────────
  /** Prepends a checkbox column and enables selection tracking. */
  enableRowSelection?: boolean;
  /** Controlled selection state. Omit to use internal state. */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /**
   * Rendered inside the bulk-actions bar when at least one row is selected.
   * Receives the selected rows and a `clearSelection` helper.
   * When enableRowSelection=true, a default "N rows selected + Clear" bar
   * is always shown; this prop appends additional actions to it.
   */
  renderBulkActions?: (
    selectedRows: Row<TData>[],
    clearSelection: () => void
  ) => React.ReactNode;
}

export function DataTable<TData>({
  data,
  columns,
  striped = false,
  highlightOnHover = false,
  withColumnBorders = false,
  className,
  style,
  getRowProps,
  getCellProps,
  enableSorting = false,
  sorting,
  onSortingChange,
  estimatedRowHeight = 36,
  overscan = 5,
  enableRowSelection = false,
  rowSelection: rowSelectionProp,
  onRowSelectionChange,
  renderBulkActions,
}: DataTableProps<TData>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks last-clicked row index for shift+click range selection.
  const lastClickedRowRef = useRef<number | null>(null);

  const rowSelection = rowSelectionProp ?? internalRowSelection;

  // Prepend a checkbox display-column when row selection is enabled.
  // Memoised on [enableRowSelection, columns] – the header/cell functions
  // receive current table/row context as arguments so no stale closures.
  // lastClickedRowRef is a ref object (stable identity), safe to close over.
  const allColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!enableRowSelection) return columns;

    const selectionColumn: ColumnDef<TData, unknown> = {
      id: '__select__',
      size: 40,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          size="xs"
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          aria-label="Select all rows"
        />
      ),
      cell: ({ row, table }) => {
        const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
          // Always stop row-level onClick from firing.
          e.stopPropagation();

          if (e.shiftKey && lastClickedRowRef.current !== null) {
            // Range selection: prevent the checkbox's own toggle, then
            // bulk-set all rows between last clicked and current.
            e.preventDefault();
            const from = lastClickedRowRef.current;
            const to = row.index;
            const [start, end] = from <= to ? [from, to] : [to, from];
            // Target state: the state the current row would become on a
            // normal click (i.e. the opposite of its current state).
            const targetSelected = !row.getIsSelected();
            table.setRowSelection((prev) => {
              const next = { ...prev };
              table.getRowModel().rows.slice(start, end + 1).forEach((r) => {
                if (r.getCanSelect()) next[r.id] = targetSelected;
              });
              return next;
            });
          }

          // Always update the last-clicked index (even for shift clicks),
          // so the next shift+click uses the correct anchor.
          lastClickedRowRef.current = row.index;
        };

        return (
          <Checkbox
            size="xs"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            onClick={handleClick}
            aria-label="Select row"
          />
        );
      },
    };

    return [selectionColumn, ...columns];
  }, [enableRowSelection, columns]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting: sorting ?? internalSorting,
      rowSelection,
    },
    onSortingChange: onSortingChange ?? setInternalSorting,
    onRowSelectionChange: onRowSelectionChange ?? setInternalRowSelection,
    enableSorting,
    enableRowSelection,
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  const colSpan = table.getVisibleFlatColumns().length;

  const selectedRows = enableRowSelection ? table.getSelectedRowModel().rows : [];
  const selectedCount = selectedRows.length;
  const clearSelection = () => table.resetRowSelection();

  // ── Shared table JSX ─────────────────────────────────────────────────────
  const tableEl = (
    <Table highlightOnHover={highlightOnHover} withColumnBorders={withColumnBorders} stickyHeader>
      <Table.Thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <Table.Tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const canSort = enableSorting && header.column.getCanSort();
              const sortDir = header.column.getIsSorted();
              const isCheckboxCol = header.column.id === '__select__';
              return (
                <Table.Th
                  key={header.id}
                  style={
                    header.column.getSize() !== 150
                      ? { width: header.column.getSize() }
                      : undefined
                  }
                  onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  className={[
                    canSort ? styles.sortableHeader : '',
                    isCheckboxCol ? styles.checkboxCol : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.headerContent}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {canSort && (
                      <span className={styles.sortIcon}>
                        {sortDir === 'asc' ? (
                          <IconChevronUp size={12} />
                        ) : sortDir === 'desc' ? (
                          <IconChevronDown size={12} />
                        ) : (
                          <IconSelector size={12} style={{ opacity: 0.4 }} />
                        )}
                      </span>
                    )}
                  </span>
                </Table.Th>
              );
            })}
          </Table.Tr>
        ))}
      </Table.Thead>
      <Table.Tbody>
        {paddingTop > 0 && (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: paddingTop, padding: 0 }} />
          </tr>
        )}
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          const rowProps = getRowProps?.(row) ?? {};
          const isSelected = enableRowSelection && row.getIsSelected();

          // Selected rows override stripes; stripe applies only to unselected even rows.
          const stripeStyle: CSSProperties =
            striped && !isSelected && virtualRow.index % 2 === 0
              ? { backgroundColor: 'var(--table-striped-color)' }
              : {};

          return (
            <Table.Tr
              key={row.id}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{ ...stripeStyle, ...rowProps.style }}
              className={[rowProps.className, isSelected ? styles.selectedRow : '']
                .filter(Boolean)
                .join(' ')}
              onClick={rowProps.onClick}
              onContextMenu={rowProps.onContextMenu}
            >
              {row.getVisibleCells().map((cell) => {
                const cellProps = getCellProps?.(cell) ?? {};

                return (
                  <Table.Td
                    key={cell.id}
                    style={cellProps.style}
                    className={[
                      cell.column.id === '__select__' ? styles.checkboxCol : '',
                      cellProps.className ?? '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={cellProps.onClick}
                    onContextMenu={cellProps.onContextMenu}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Table.Td>
                );
              })}
            </Table.Tr>
          );
        })}
        {paddingBottom > 0 && (
          <tr aria-hidden>
            <td colSpan={colSpan} style={{ height: paddingBottom, padding: 0 }} />
          </tr>
        )}
      </Table.Tbody>
    </Table>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // Without row selection: keep the original single-div structure so
  // className/style on the scroll container work exactly as before.
  if (!enableRowSelection) {
    return (
      <div
        ref={scrollRef}
        className={`${styles.scrollContainer} ${className ?? ''}`}
        style={style}
      >
        {tableEl}
      </div>
    );
  }

  // With row selection: flex-column wrapper (className/style go here),
  // bulk-actions bar, then a flex-growing scroll container.
  return (
    <div className={`${styles.selectionWrapper} ${className ?? ''}`} style={style}>
      {renderBulkActions && selectedCount > 0 && (
        <div className={styles.bulkActionsBar}>
          <Group gap="sm" align="center" wrap="nowrap">
            <Text size="sm" fw={500}>
              {selectedCount} {selectedCount === 1 ? 'row' : 'rows'} selected
            </Text>
            <Button size="xs" variant="subtle" color="gray" onClick={clearSelection}>
              Clear
            </Button>
            {renderBulkActions(selectedRows, clearSelection)}
          </Group>
        </div>
      )}
      <div ref={scrollRef} className={styles.scrollContainerFlex}>
        {tableEl}
      </div>
    </div>
  );
}
