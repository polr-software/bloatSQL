import { useLayoutEffect, useRef, useState } from 'react';
import {
  AppShell,
  Stack,
  Text,
  Button,
  Group,
  Badge,
  Alert,
  Title,
  ScrollArea,
} from '@mantine/core';
import { SmartColumnInput } from './SmartColumnInput';
import type { SmartColumnInputElement } from './SmartColumnInput';
import { useForm } from '@mantine/form';
import { IconCheck, IconX, IconAlertCircle, IconDeviceFloppy } from '@tabler/icons-react';
import {
  useSelectedCell,
  useClearCellSelection,
  useIsSavingCell,
  useSetSavingCell,
  useEditCellError,
  useSetEditCellError,
} from '../../stores/editCellStore';
import { tauriCommands } from '../../tauri/commands';
import { useQueryExecutionStore } from '../../stores/queryExecutionStore';
import { useConsoleLogStore } from '../../stores/consoleLogStore';
import {
  buildCellEditInitialValues,
  buildChangedCellRequests,
  getCellEditValidationError,
  isMultilineCellValue,
  submitChangedCellRequests,
} from './cellEditForm.logic';

export function CellEditForm() {
  const selectedCell = useSelectedCell();
  const clearSelection = useClearCellSelection();
  const isSaving = useIsSavingCell();
  const setSaving = useSetSavingCell();
  const error = useEditCellError();
  const setError = useSetEditCellError();
  const inputRef = useRef<SmartColumnInputElement | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const form = useForm({
    mode: 'controlled',
    initialValues: buildCellEditInitialValues(selectedCell),
  });

  useLayoutEffect(() => {
    if (selectedCell) {
      const initialValues = buildCellEditInitialValues(selectedCell);
      form.setInitialValues(initialValues);
      form.reset();
      setShowSaved(false);

      inputRef.current?.focus();

      if (
        inputRef.current instanceof HTMLInputElement ||
        inputRef.current instanceof HTMLTextAreaElement
      ) {
        inputRef.current.select();
      }
    }
  }, [selectedCell]);

  const handleSubmit = async (values: Record<string, string>) => {
    const validationError = getCellEditValidationError(selectedCell);
    if (validationError) {
      setError(validationError);
      return;
    }

    const currentCell = selectedCell;
    if (!currentCell) {
      return;
    }

    const changedRequests = buildChangedCellRequests(currentCell, values);

    if (changedRequests.length === 0) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await submitChangedCellRequests({
        requests: changedRequests,
        updateCell: tauriCommands.updateCell,
        refreshTable: useQueryExecutionStore.getState().refreshTable,
        addConsoleLog: useConsoleLogStore.getState().addLog,
      });

      form.resetDirty(values);

      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    clearSelection();
    form.reset();
    setError(null);
  };

  if (!selectedCell) {
    return null;
  }

  const visibleColumnNames = selectedCell.visibleColumnNames.filter(
    (columnName) => columnName in selectedCell.rowData
  );
  const remainingColumnNames = Object.keys(selectedCell.rowData).filter(
    (columnName) => !selectedCell.visibleColumnNames.includes(columnName)
  );
  const columnNames = [...visibleColumnNames, ...remainingColumnNames];
  const columnMeta = selectedCell.columns ?? [];
  const isDirty = form.isDirty();

  const renderLabel = (columnName: string, isPrimaryKey: boolean, isFocused: boolean, dataType?: string) => (
    <Group gap={4}>
      <Text size="sm">{columnName}</Text>
      {isPrimaryKey && <Badge size="xs" variant="light" color="yellow">PK</Badge>}
      {isFocused && <Badge size="xs" variant="light">Focused</Badge>}
      {dataType && <Badge size="xs" variant="light" color="dimmed">{dataType}</Badge>}
    </Group>
  );

  return (
    <>
      <AppShell.Section>
        <Title order={4} mb="xs">Edit Row</Title>
        <Group gap="xs" mb="md">
          <Badge variant="light">Row {selectedCell.rowIndex + 1}</Badge>
          {selectedCell.tableName && (
            <Badge variant="light" color="gray">{selectedCell.tableName}</Badge>
          )}
        </Group>

        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            withCloseButton
            onClose={() => setError(null)}
            mb="md"
            styles={{
              message: {
                fontFamily: 'monospace',
                fontSize: 'var(--mantine-font-size-sm)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              },
            }}
          >
            {error}
          </Alert>
        )}
      </AppShell.Section>

      <AppShell.Section grow component={ScrollArea} type="hover">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            {columnNames.map((columnName) => {
              const rawValue = selectedCell.rowData[columnName];
              const isFocused = columnName === selectedCell.focusedColumn;
              const isPrimaryKey = columnName === selectedCell.primaryKeyColumn;
              const col = columnMeta.find((c) => c.name === columnName);
              const dataType = col?.dataType ?? '';
              const isMultiline = !dataType && isMultilineCellValue(rawValue);

              return (
                <SmartColumnInput
                  key={columnName}
                  dataType={dataType}
                  value={form.values[columnName] ?? ''}
                  onChange={(val) => form.setFieldValue(columnName, val)}
                  label={renderLabel(columnName, isPrimaryKey, isFocused, col?.dataType)}
                  placeholder="Enter value"
                  disabled={isSaving || isPrimaryKey}
                  forceMultiline={isMultiline}
                  inputRef={isFocused ? inputRef : undefined}
                />
              );
            })}
          </Stack>
        </form>
      </AppShell.Section>

      <AppShell.Section mt="md">
        <Group justify="flex-end" gap="xs">
          <Button
            variant="default"
            onClick={handleCancel}
            disabled={isSaving}
            leftSection={<IconX size={16} />}
          >
            Close
          </Button>
          <Button
            onClick={() => form.onSubmit(handleSubmit)()}
            loading={isSaving}
            disabled={!isDirty || showSaved}
            color={showSaved ? 'green' : undefined}
            leftSection={showSaved ? <IconCheck size={16} /> : <IconDeviceFloppy size={16} />}
          >
            {showSaved ? 'Saved' : 'Save Changes'}
          </Button>
        </Group>
      </AppShell.Section>
    </>
  );
}
