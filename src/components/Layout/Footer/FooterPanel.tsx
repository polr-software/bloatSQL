import { memo, useCallback } from "react";
import { Box } from "@mantine/core";
import styles from "./Footer.module.css";
import { useFooterCollapsed } from "../../../stores/layoutStore";
import {
  useViewMode,
  useSelectedTable,
} from "../../../stores/tableViewStore";
import {
  useIsEditingStructure,
  usePendingOperations,
  useStructureEditStore,
} from "../../../stores/structureEditStore";
import { useActiveConnection } from "../../../stores/connectionStore";
import { DatabaseType } from "../../../types/database";
import { ConsoleLog } from "./ConsoleLog";
import { PendingChangesPreview } from "../../TableStructure/components/PendingChangesPreview";

function FooterPanelComponent() {
  const collapsed = useFooterCollapsed();

  const viewMode = useViewMode();
  const selectedTable = useSelectedTable();

  const isEditingStructure = useIsEditingStructure();
  const pendingOperations = usePendingOperations();
  const activeConnection = useActiveConnection();
  const dbType = activeConnection?.dbType ?? DatabaseType.MariaDB;

  const { removeOperationByIndex, clearAllPending } = useStructureEditStore();

  const handleUndoOperation = useCallback(
    (index: number) => {
      removeOperationByIndex(index);
    },
    [removeOperationByIndex]
  );

  const handleClearAll = useCallback(() => {
    clearAllPending();
  }, [clearAllPending]);

  const showPendingPreview = viewMode === 'structure' && !!selectedTable && isEditingStructure && pendingOperations.length > 0;

  return (
    <Box className={collapsed ? styles.panelHidden : styles.panelVisible}>
      {showPendingPreview ? (
        <Box
          w="100%"
          style={{
            borderTop: '1px solid var(--mantine-color-default-border)',
            overflow: 'auto'
          }}
          bg="var(--mantine-color-default)"
          h={239}
          p="md"
        >
          <PendingChangesPreview
            tableName={selectedTable}
            operations={pendingOperations}
            dbType={dbType}
            onUndoOperation={handleUndoOperation}
            onClearAll={handleClearAll}
          />
        </Box>
      ) : (
        <ConsoleLog />
      )}
    </Box>
  );
}

export const FooterPanel = memo(FooterPanelComponent);
