import { useEffect, useState } from 'react';
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
import { useForm } from '@mantine/form';
import { IconPlus, IconX, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import {
  useAddRowTableName,
  useAddRowColumns,
  useEditCellStore,
} from '../../stores/editCellStore';
import { useQueryExecutionStore } from '../../stores/queryExecutionStore';
import { tauriCommands } from '../../tauri/commands';
import {
  buildAddRowInitialValues,
  canAddRowColumnBeNull,
  getAddRowDescription,
  getAddRowPlaceholder,
  isAddRowColumnRequired,
  submitAddRowForm,
  validateAddRowValues,
} from './addRowForm.logic';


export function AddRowForm() {
  const tableName = useAddRowTableName();
  const columns = useAddRowColumns();
  const stopAddRow = useEditCellStore((s) => s.stopAddRow);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInserted, setShowInserted] = useState(false);
  const [nullColumns, setNullColumns] = useState<Record<string, boolean>>({});

  const form = useForm({
    mode: 'controlled',
    initialValues: buildAddRowInitialValues(columns),
    validate: (values) => validateAddRowValues(columns, values, nullColumns),
    validateInputOnChange: true,
  });

  useEffect(() => {
    const initialValues = buildAddRowInitialValues(columns);
    form.setInitialValues(initialValues);
    form.reset();
    setNullColumns({});
    setError(null);
    setShowInserted(false);
  }, [columns, tableName]);

  const handleSubmit = async (values: Record<string, string>) => {
    setIsSaving(true);
    setError(null);

    try {
      await submitAddRowForm({
        tableName,
        columns,
        values,
        nullColumns,
        addRow: tauriCommands.addRow,
        refreshTable: useQueryExecutionStore.getState().refreshTable,
      });

      setShowInserted(true);
      setTimeout(() => setShowInserted(false), 2000);

      form.reset();
      setNullColumns({});
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    stopAddRow();
  };

  if (!tableName) return null;

  const hasErrors = Object.keys(form.errors).length > 0;

  const handleFieldChange = (columnName: string, value: string) => {
    if (nullColumns[columnName]) {
      setNullColumns((current) => ({
        ...current,
        [columnName]: false,
      }));
    }

    form.setFieldValue(columnName, value);
  };

  const toggleNullValue = (columnName: string) => {
    setNullColumns((current) => ({
      ...current,
      [columnName]: !current[columnName],
    }));
    form.setFieldValue(columnName, '');
  };

  return (
    <>
      <AppShell.Section>
        <Title order={4} mb="xs">Add Row</Title>
        <Group gap="xs" mb="md">
          <Badge variant="light" color="gray">{tableName}</Badge>
        </Group>

        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            withCloseButton
            onClose={() => setError(null)}
            mb="md"
          >
            {error}
          </Alert>
        )}
      </AppShell.Section>

      <AppShell.Section grow component={ScrollArea} type="hover">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            {columns.map((col) => {
              const required = isAddRowColumnRequired(col);
              const placeholder = getAddRowPlaceholder(col);
              const useNull = Boolean(nullColumns[col.name]);
              const canUseNull = canAddRowColumnBeNull(col);
              const description = getAddRowDescription(col, useNull);

              const label = (
                <Group gap={4}>
                  <Text size="sm">{col.name}</Text>
                  {col.isPrimaryKey && <Badge size="xs" variant="light" color="yellow">PK</Badge>}
                  <Badge size="xs" variant="light" color="dimmed">{col.dataType}</Badge>
                </Group>
              );

              return (
                <Stack key={col.name} gap={4}>
                  <SmartColumnInput
                    dataType={col.dataType}
                    value={form.values[col.name] ?? ''}
                    onChange={(val) => handleFieldChange(col.name, val)}
                    label={label}
                    placeholder={placeholder}
                    description={description}
                    withAsterisk={required}
                    error={form.errors[col.name]}
                    disabled={isSaving || useNull}
                  />
                  {canUseNull && (
                    <Group justify="flex-end">
                      <Button
                        type="button"
                        size="xs"
                        variant={useNull ? 'filled' : 'light'}
                        color={useNull ? 'blue' : 'gray'}
                        onClick={() => toggleNullValue(col.name)}
                        disabled={isSaving}
                      >
                        {useNull ? 'Using NULL' : 'Use NULL'}
                      </Button>
                    </Group>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </form>
      </AppShell.Section>

      <AppShell.Section mt="md">
        <Group justify="flex-end" gap="xs">
          <Button
            variant="default"
            onClick={handleClose}
            disabled={isSaving}
            leftSection={<IconX size={16} />}
          >
            Close
          </Button>
          <Button
            onClick={() => form.onSubmit(handleSubmit)()}
            loading={isSaving}
            disabled={showInserted || hasErrors}
            color={showInserted ? 'green' : undefined}
            leftSection={showInserted ? <IconCheck size={16} /> : <IconPlus size={16} />}
          >
            {showInserted ? 'Inserted' : 'Insert'}
          </Button>
        </Group>
      </AppShell.Section>
    </>
  );
}
