import { memo } from "react";
import { SegmentedControl, Center, Group, ActionIcon, Tooltip, Button, Text, Divider } from "@mantine/core";
import { IconTable, IconList, IconSql, IconPlus, IconSchema, IconDownload } from "@tabler/icons-react";
import styles from "./Footer.module.css";
import { useLayoutStore } from "../../../stores/layoutStore";
import {
  useViewMode,
  useSetViewMode,
  useSelectedTable,
  useQueryEditorVisible,
  useToggleQueryEditor,
} from "../../../stores/tableViewStore";
import { StructureControls } from "./StructureControls";
import { tauriCommands } from "../../../tauri/commands";
import { useEditCellStore } from "../../../stores/editCellStore";
import { useActiveConnection } from "../../../connections";
import { useCurrentDatabase } from "../../../stores/databaseBrowserStore";
import { getSchemaCacheKey, useSchemaStore } from "../../../stores/schemaStore";
import {
  useSelectedRows,
  useSelectedRowCount,
  useClearRowSelection,
  useExportRowsFn,
} from "../../../stores/rowSelectionStore";

// Isolated component so row-selection store changes don't re-render the whole toolbar
function RowSelectionControls() {
  const selectedRows = useSelectedRows();
  const selectedCount = useSelectedRowCount();
  const clearRowSelection = useClearRowSelection();
  const exportRowsFn = useExportRowsFn();

  if (selectedCount === 0) return null;

  return (
    <>
      <Divider orientation="vertical" />
      <Text size="sm" c="dimmed">
        {selectedCount} {selectedCount === 1 ? 'row' : 'rows'} selected
      </Text>
      <Button size="xs" variant="subtle" color="gray" onClick={() => clearRowSelection?.()}>
        Clear
      </Button>
      {exportRowsFn && (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconDownload size={14} />}
          onClick={() => {
            exportRowsFn(selectedRows);
            clearRowSelection?.();
          }}
        >
          Export selected
        </Button>
      )}
      <Divider orientation="vertical" />
    </>
  );
}

function FooterControlsComponent() {
  const activeConnection = useActiveConnection();
  const currentDatabase = useCurrentDatabase();
  const schemaCacheKey = getSchemaCacheKey(activeConnection?.id, currentDatabase);
  const ensureTableColumns = useSchemaStore((s) => s.ensureTableColumns);
  const viewMode = useViewMode();
  const setViewMode = useSetViewMode();
  const selectedTable = useSelectedTable();
  const queryEditorVisible = useQueryEditorVisible();
  const toggleQueryEditor = useToggleQueryEditor();

  return (
    <Group justify="space-between" w="100%" px="md" className={styles.controls}>
      <Group gap="xs">
        <SegmentedControl
          value={viewMode}
          onChange={(value) => setViewMode(value as 'data' | 'structure' | 'diagram')}
          disabled={!selectedTable && viewMode !== 'diagram'}
          data={[
            {
              value: 'data',
              label: (
                <Center className={styles.segmentLabel}>
                  <IconTable size={16} stroke={1.5} />
                  <span>Data</span>
                </Center>
              ),
            },
            {
              value: 'structure',
              label: (
                <Center className={styles.segmentLabel}>
                  <IconList size={16} stroke={1.5} />
                  <span>Structure</span>
                </Center>
              ),
            },
            {
              value: 'diagram',
              label: (
                <Center className={styles.segmentLabel}>
                  <IconSchema size={16} stroke={1.5} />
                  <span>Diagram</span>
                </Center>
              ),
            },
          ]}
        />

        {viewMode === 'data' && <RowSelectionControls />}

        {viewMode === 'data' && (
          <Button
            variant="default"
            leftSection={<IconPlus size={16} />}
            disabled={!selectedTable}
            onClick={async () => {
              if (!selectedTable) return;
              try {
                const columns = schemaCacheKey
                  ? await ensureTableColumns(schemaCacheKey, selectedTable)
                  : await tauriCommands.getTableColumns(selectedTable);
                useEditCellStore.getState().startAddRow(selectedTable, columns);
                useLayoutStore.getState().setAsideCollapsed(false);
              } catch {
              }
            }}
          >
            Add row
          </Button>
        )}

        {viewMode === 'structure' && selectedTable && (
          <StructureControls />
        )}
      </Group>

      {viewMode === 'data' && (
        <Tooltip withArrow label={queryEditorVisible ? "Hide Query Editor" : "Show Query Editor"}>
          <ActionIcon
            variant={queryEditorVisible ? "filled" : "default"}
            size="lg"
            onClick={toggleQueryEditor}
            disabled={!selectedTable}
          >
            <IconSql stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

export const FooterControls = memo(FooterControlsComponent);
