import { useCallback } from 'react';
import { AppShell, Stack, Button, Group, Badge, Alert, Text } from '@mantine/core';
import { IconCheck, IconX, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import {
  useStructureEditStore,
  usePendingOperations,
  useIsApplyingStructure,
  useStructureEditError,
} from '../../stores/structureEditStore';
import { useSelectedTable } from '../../stores/tableViewStore';
import { useActiveConnection } from '../../stores/connectionStore';
import { DatabaseType } from '../../types/database';
import { useApplyStructureChanges } from '../TableStructure/hooks/useApplyStructureChanges';
import { useTableStructure } from '../TableStructure/hooks/useTableStructure';
import { PendingChangesPreview } from '../TableStructure/components/PendingChangesPreview';
import { useSchemaMutationSync } from '../../hooks/useSchemaMutationSync';
import {
  formatSchemaMutationError,
  getSchemaMutationFailureNotification,
  getSchemaMutationSuccessNotification,
} from './schemaMutationFeedback';

export function StructureEditControls() {
  const selectedTable = useSelectedTable();
  const activeConnection = useActiveConnection();
  const dbType = activeConnection?.dbType ?? DatabaseType.MariaDB;

  const { refetch } = useTableStructure(selectedTable);

  const pendingOperations = usePendingOperations();
  const isApplyingStore = useIsApplyingStructure();
  const error = useStructureEditError();

  const {
    stopEditing,
    clearAllPending,
    setApplying,
    setError: setStoreError,
    clearColumnDraft,
    removeOperationByIndex,
  } = useStructureEditStore();

  const { applyChanges, isApplying: isApplyingHook } = useApplyStructureChanges();
  const syncSchemaMutation = useSchemaMutationSync();
  const isApplying = isApplyingStore || isApplyingHook;

  const handleApplyChanges = useCallback(async () => {
    if (!selectedTable || pendingOperations.length === 0) return;

    setApplying(true);
    setStoreError(null);

    const result = await applyChanges(selectedTable, pendingOperations);

    setApplying(false);

    if (result.success) {
      await Promise.all([refetch(), syncSchemaMutation(selectedTable)]);

      notifications.show({
        title: 'Success',
        message: getSchemaMutationSuccessNotification(result.executedOperations),
        color: 'green',
      });
      clearAllPending();
      clearColumnDraft();
      stopEditing();
    } else {
      const errorMsg = formatSchemaMutationError(result);
      setStoreError(errorMsg);
      notifications.show({
        title: 'Error',
        message: getSchemaMutationFailureNotification(result),
        color: 'red',
      });
    }
  }, [
    selectedTable,
    pendingOperations,
    applyChanges,
    setApplying,
    setStoreError,
    clearAllPending,
    clearColumnDraft,
    stopEditing,
    refetch,
    syncSchemaMutation,
  ]);

  const handleCancelAll = useCallback(() => {
    clearAllPending();
    clearColumnDraft();
    stopEditing();
  }, [clearAllPending, clearColumnDraft, stopEditing]);

  if (pendingOperations.length === 0) {
    return null;
  }

  return (
    <>
      <AppShell.Section>
        <Stack gap="md">
          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              withCloseButton
              onClose={() => setStoreError(null)}
            >
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </Text>
            </Alert>
          )}

          <PendingChangesPreview
            tableName={selectedTable ?? ''}
            operations={pendingOperations}
            dbType={dbType}
            onUndoOperation={removeOperationByIndex}
            onClearAll={clearAllPending}
          />

          <Group gap="xs" grow>
            <Button
              variant="filled"
              color="green"
              leftSection={<IconCheck size={16} />}
              onClick={handleApplyChanges}
              loading={isApplying}
              rightSection={
                <Badge size="sm" color="white" variant="filled" circle>
                  {pendingOperations.length}
                </Badge>
              }
            >
              Apply All
            </Button>
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconX size={16} />}
              onClick={handleCancelAll}
              disabled={isApplying}
            >
              Cancel All
            </Button>
          </Group>
        </Stack>
      </AppShell.Section>
    </>
  );
}
