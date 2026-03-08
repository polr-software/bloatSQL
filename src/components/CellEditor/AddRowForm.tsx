import { useState } from 'react';
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
import { tauriCommands } from '../../tauri/commands';
import { useQueryStore } from '../../stores/queryStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { DatabaseType, TableColumn } from '../../types/database';

function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === DatabaseType.PostgreSQL) {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `\`${name.replace(/`/g, '``')}\``;
}

function escapeValue(value: string): string {
  return value.replace(/'/g, "''");
}

function isColumnRequired(col: TableColumn): boolean {
  return !col.isNullable && !col.isPrimaryKey && col.columnDefault == null;
}

function buildValidate(columns: TableColumn[]) {
  return (values: Record<string, string>) => {
    const errors: Record<string, string> = {};
    for (const col of columns) {
      if (isColumnRequired(col) && (!values[col.name] || values[col.name].trim() === '')) {
        errors[col.name] = 'To pole jest wymagane';
      }
    }
    return errors;
  };
}


export function AddRowForm() {
  const tableName = useAddRowTableName();
  const columns = useAddRowColumns();
  const stopAddRow = useEditCellStore((s) => s.stopAddRow);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInserted, setShowInserted] = useState(false);

  const initialValues = columns.reduce((acc, col) => {
    acc[col.name] = '';
    return acc;
  }, {} as Record<string, string>);

  const form = useForm({
    mode: 'controlled',
    initialValues,
    validate: buildValidate(columns),
  });

  const handleSubmit = async (values: Record<string, string>) => {
    if (!tableName) return;

    setIsSaving(true);
    setError(null);

    try {
      const dbType = useConnectionStore.getState().activeConnection?.dbType ?? DatabaseType.MariaDB;
      const quotedTable = quoteIdentifier(tableName, dbType);

      const columnNames = columns.map((col) => quoteIdentifier(col.name, dbType)).join(', ');
      const valueParts = columns.map((col) => {
        const val = values[col.name];
        if (val === '' || val === undefined) {
          return 'DEFAULT';
        }
        return `'${escapeValue(val)}'`;
      });

      const sql = `INSERT INTO ${quotedTable} (${columnNames}) VALUES (${valueParts.join(', ')})`;

      await tauriCommands.executeQuery(sql);
      await useQueryStore.getState().refreshTable();

      setShowInserted(true);
      setTimeout(() => setShowInserted(false), 2000);

      form.reset();
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
              const required = isColumnRequired(col);
              const placeholder = col.columnDefault
                ? `Default: ${col.columnDefault}`
                : col.isPrimaryKey
                  ? 'Auto / leave empty for DEFAULT'
                  : col.isNullable
                    ? 'NULL if empty'
                    : 'Required';

              const label = (
                <Group gap={4}>
                  <Text size="sm">{col.name}</Text>
                  {col.isPrimaryKey && <Badge size="xs" variant="light" color="yellow">PK</Badge>}
                  <Badge size="xs" variant="light" color="dimmed">{col.dataType}</Badge>
                </Group>
              );

              return (
                <SmartColumnInput
                  key={col.name}
                  dataType={col.dataType}
                  value={form.values[col.name] ?? ''}
                  onChange={(val) => form.setFieldValue(col.name, val)}
                  label={label}
                  placeholder={placeholder}
                  withAsterisk={required}
                  error={form.errors[col.name]}
                  disabled={isSaving}
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
