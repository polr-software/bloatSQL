import { useMemo, useCallback, useEffect, useState } from 'react';
import { Tree, useTree, Group, Loader, Center, Stack, Text } from '@mantine/core';
import { IconTable, IconKey, IconColumns } from '@tabler/icons-react';
import type { TreeNodeData, RenderTreeNodePayload } from '@mantine/core';
import type { TableColumn } from '../../../types/database';
import { tauriCommands } from '../../../tauri/commands';
import classes from './DatabaseTree.module.css';

interface DatabaseTreeProps {
  tables: string[] | null;
  isLoadingTables: boolean;
  isConnected: boolean;
  selectedTable: string | null;
  onSelectTable: (tableName: string) => void;
  searchQuery: string;
}

interface TableNode extends TreeNodeData {
  nodeType: 'table';
  tableName: string;
}

interface ColumnNode extends TreeNodeData {
  nodeType: 'column';
  column?: TableColumn;
}

type DatabaseTreeNode = TableNode | ColumnNode;

function NodeIcon({ nodeType, column }: { nodeType: string; column?: TableColumn }) {
  if (nodeType === 'table') {
    return <IconTable size={14} stroke={1.5} />;
  }

  if (column?.isPrimaryKey) {
    return <IconKey size={14} style={{ color: 'var(--mantine-primary-color-filled)' }} />;
  }

  return <IconColumns size={14} />;
}

export function DatabaseTree({
  tables,
  isLoadingTables,
  isConnected,
  selectedTable,
  onSelectTable,
  searchQuery,
}: DatabaseTreeProps) {
  const [tableColumns, setTableColumns] = useState<Record<string, TableColumn[]>>({});
  const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());

  const loadColumnsForTable = useCallback((tableName: string) => {
    if (tableColumns[tableName] || loadingColumns.has(tableName)) {
      return;
    }

    setLoadingColumns((prev) => new Set(prev).add(tableName));

    tauriCommands.getTableColumns(tableName)
      .then((columns) => {
        setTableColumns((prev) => ({ ...prev, [tableName]: columns }));
      })
      .catch((error) => {
        console.error('Failed to load columns:', error);
      })
      .finally(() => {
        setLoadingColumns((prev) => {
          const newSet = new Set(prev);
          newSet.delete(tableName);
          return newSet;
        });
      });
  }, [tableColumns, loadingColumns]);

  const filteredTables = useMemo(
    () => tables?.filter((table) =>
      table.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [],
    [tables, searchQuery]
  );

  const treeData = useMemo<DatabaseTreeNode[]>(() => {
    return filteredTables.map((table) => {
      const columns = tableColumns[table];
      const isLoading = loadingColumns.has(table);
      const hasData = columns !== undefined;

      const node: TableNode = {
        value: `table-${table}`,
        label: table,
        nodeType: 'table',
        tableName: table,
        children: !hasData && !isLoading
          ? undefined
          : isLoading
            ? [{
              value: `loading-${table}`,
              label: 'Loading...',
              nodeType: 'column',
            } as ColumnNode]
            : columns.length > 0
              ? columns.map((column): ColumnNode => ({
                value: `column-${table}-${column.name}`,
                label: column.name,
                nodeType: 'column',
                column,
              }))
              : [{
                value: `empty-${table}`,
                label: 'No columns',
                nodeType: 'column',
              } as ColumnNode],
      };

      return node;
    });
  }, [filteredTables, tableColumns, loadingColumns]);

  const tree = useTree({
    initialExpandedState: selectedTable ? { [`table-${selectedTable}`]: true } : {},
    initialSelectedState: selectedTable ? [`table-${selectedTable}`] : [],
    multiple: false,
    onNodeExpand: (value: string) => {
      const tableName = value.replace('table-', '');
      loadColumnsForTable(tableName);
    },
  });

  useEffect(() => {
    setTableColumns({});
    setLoadingColumns(new Set());
  }, [tables]);

  useEffect(() => {
    if (selectedTable) {
      tree.select(`table-${selectedTable}`);
      tree.expand(`table-${selectedTable}`);
      loadColumnsForTable(selectedTable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable]);

  const renderNode = useCallback(
    ({ node, elementProps }: RenderTreeNodePayload) => {
      const dbNode = node as DatabaseTreeNode;

      if (dbNode.nodeType === 'table') {
        const tableNode = dbNode as TableNode;

        return (
          <Group
            gap={5}
            px={'xs'}
            {...elementProps}
            onClick={(e) => {
              elementProps.onClick(e);
              onSelectTable(tableNode.tableName);
            }}
          >
            <NodeIcon nodeType="table" />
            <Text size="sm">{tableNode.label}</Text>
          </Group>
        );
      }

      if (dbNode.nodeType === 'column') {
        const columnNode = dbNode as ColumnNode;

        if (!columnNode.column) {
          return (
            <Group gap={5} {...elementProps}>
              <Loader size={12} />
              <Text size="xs" c="dimmed">Loading columns...</Text>
            </Group>
          );
        }

        const { column } = columnNode;

        return (
          <Group gap={5} wrap="nowrap" {...elementProps}>
            <NodeIcon nodeType="column" column={column} />
            <Text
              size="xs"
              fw={column.isPrimaryKey ? 600 : 400}
              truncate="end"
              style={{ flex: 1 }}
            >
              {column.name}
              {!column.isNullable && <Text component="span" c="red" inherit> *</Text>}
            </Text>
            <Text
              size="xs"
              c="dimmed"
              truncate="end"
            >
              {column.dataType.toLowerCase()}
            </Text>
          </Group>
        );
      }

      return null;
    },
    [onSelectTable]
  );

  if (isLoadingTables) {
    return (
      <Center h={100}>
        <Loader size="sm" />
      </Center>
    );
  }

  if (!tables || tables.length === 0) {
    return (
      <Center h={100}>
        <Text size="sm" c="dimmed" ta="center">
          {isConnected ? 'No tables found' : 'Select a database'}
        </Text>
      </Center>
    );
  }

  if (filteredTables.length === 0) {
    return (
      <Center h={100}>
        <Text size="sm" c="dimmed" ta="center">
          No tables match your search
        </Text>
      </Center>
    );
  }

  return (
    <Stack gap={0}>
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb="xs">
        Tables ({filteredTables.length})
      </Text>
      <Tree
        classNames={classes}
        data={treeData}
        tree={tree}
        renderNode={renderNode}
        levelOffset={16}
        selectOnClick
        clearSelectionOnOutsideClick
      />
    </Stack>
  );
}
