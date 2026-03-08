import {
  Stack,
  Group,
  Checkbox,
  Radio,
  TextInput,
  NumberInput,
  Button,
  Text,
  ScrollArea,
  Divider,
  Card,
  Alert,
  Select,
  ActionIcon,
  Collapse,
  Loader,
  LoadingOverlay,
  Badge,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect, useState } from 'react';
import { DataExportMode, ExportOptions } from '../../../types/database';
import { useQueryStore } from '../../../stores/queryStore';
import {
  useExportDatabase,
  useIsExporting,
  useExportError,
  useExportSuccessMessage,
  useClearExportError,
  useClearExportSuccess,
} from '../../../stores/exportStore';
import { open } from '@tauri-apps/plugin-dialog';
import { tauriCommands } from '../../../tauri/commands';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
} from '@tabler/icons-react';

interface DatabaseExportFormProps {
  databaseName: string;
  onSuccess: () => void;
}

interface FormValues {
  includeDrop: boolean;
  includeCreate: boolean;
  dataMode: DataExportMode;
  fileName: string;
  outputPath: string;
  exportFormat: 'sql';
  maxInsertSize: number;
  addLocks: boolean;
  disableForeignKeyChecks: boolean;
  selectedTables: string[];
}

interface TableStats {
  name: string;
  rowCount: number;
  estimatedSize: string;
}

function estimateSizeFromRows(rows: number): string {
  const bytes = rows * 500;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DatabaseExportForm({
  databaseName,
  onSuccess,
}: DatabaseExportFormProps) {
  const { tables } = useQueryStore();
  const exportDatabase = useExportDatabase();
  const isExporting = useIsExporting();
  const exportError = useExportError();
  const exportSuccess = useExportSuccessMessage();
  const clearExportError = useClearExportError();
  const clearExportSuccess = useClearExportSuccess();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tableStats, setTableStats] = useState<TableStats[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  const form = useForm<FormValues>({
    initialValues: {
      includeDrop: false,
      includeCreate: true,
      dataMode: DataExportMode.Insert,
      fileName: `${databaseName}_export_${new Date().getTime()}.sql`,
      outputPath: '',
      exportFormat: 'sql',
      maxInsertSize: 1000,
      addLocks: false,
      disableForeignKeyChecks: false,
      selectedTables: [],
    },
    validate: {
      outputPath: (value) =>
        !value ? 'Please select an output folder' : null,
      selectedTables: (value) =>
        value.length === 0 ? 'Please select at least one table' : null,
      maxInsertSize: (value) =>
        value < 1 || value > 10000 ? 'Must be between 1 and 10,000' : null,
      fileName: (value) => {
        if (!value) return 'File name is required';
        if (!/^[^<>:"/\\|?*]+$/.test(value))
          return 'Invalid file name characters';
        return null;
      },
    },
  });

  useEffect(() => {
    if (tables && tables.length > 0 && form.values.selectedTables.length === 0) {
      form.setFieldValue('selectedTables', [...tables]);
    }
  }, [tables]);

  useEffect(() => {
    form.setFieldValue(
      'fileName',
      `${databaseName}_export_${new Date().getTime()}.sql`
    );
    clearExportSuccess();
    clearExportError();
  }, [databaseName, clearExportSuccess, clearExportError]);

  const loadTableStats = async () => {
    if (!tables || tables.length === 0) return;

    setIsLoadingStats(true);
    const stats: TableStats[] = [];

    try {
      for (const table of tables) {
        try {
          const result = await tauriCommands.executeQuery(
            `SELECT COUNT(*) as count FROM \`${table}\``
          );
          const rowCount = (result.rows[0]?.count as number) || 0;
          const estimatedSize = estimateSizeFromRows(rowCount);
          stats.push({ name: table, rowCount, estimatedSize });
        } catch {
          stats.push({ name: table, rowCount: 0, estimatedSize: 'Unknown' });
        }
      }
      setTableStats(stats);
    } catch (error) {
      console.error('Failed to load table stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const getTotalStats = () => {
    const selectedStats = tableStats.filter((t) =>
      form.values.selectedTables.includes(t.name)
    );
    const totalRows = selectedStats.reduce((sum, t) => sum + t.rowCount, 0);
    return {
      totalRows,
      totalTables: selectedStats.length,
      estimatedSize: estimateSizeFromRows(totalRows),
    };
  };

  const handleSelectAllTables = () => {
    if (tables) {
      form.setFieldValue('selectedTables', [...tables]);
    }
  };

  const handleDeselectAllTables = () => {
    form.setFieldValue('selectedTables', []);
  };

  const handleToggleTable = (tableName: string) => {
    const current = form.values.selectedTables;
    if (current.includes(tableName)) {
      form.setFieldValue(
        'selectedTables',
        current.filter((t) => t !== tableName)
      );
    } else {
      form.setFieldValue('selectedTables', [...current, tableName]);
    }
  };

  const handleSelectOutputPath = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        title: 'Select folder to save export',
      });

      if (selectedPath) {
        form.setFieldValue('outputPath', selectedPath);
      }
    } catch (error) {
      console.error('Path selection cancelled or failed:', error);
    }
  };

  const handleExport = async () => {
    const validation = form.validate();
    if (validation.hasErrors) return;

    const options: ExportOptions = {
      includeDrop: form.values.includeDrop,
      includeCreate: form.values.includeCreate,
      dataMode: form.values.dataMode,
      selectedTables: form.values.selectedTables,
      outputPath: form.values.outputPath,
      fileName: form.values.fileName,
      maxInsertSize: form.values.maxInsertSize,
    };

    await exportDatabase(options);

    if (!exportError) {
      setTimeout(() => onSuccess(), 3000);
    }
  };

  const stats = getTotalStats();
  const hasLargeDataset = stats.totalRows > 100000;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleExport();
      }}
    >
      <Stack gap="md" pos="relative">
        <LoadingOverlay
          visible={isExporting}
          overlayProps={{ radius: 'sm', blur: 2 }}
          loaderProps={{
            children: (
              <Stack align="center" gap="md">
                <Loader size="lg" />
                <Text size="sm" c="dimmed">
                  Exporting database... This may take a while for large
                  datasets.
                </Text>
              </Stack>
            ),
          }}
        />

        {exportSuccess && (
          <Alert
            icon={<IconCheck size={16} />}
            color="green"
            onClose={clearExportSuccess}
          >
            <Text size="sm">{exportSuccess}</Text>
          </Alert>
        )}

        {exportError && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Export Failed"
            color="red"
            onClose={clearExportError}
          >
            {exportError}
          </Alert>
        )}

        {hasLargeDataset && (
          <Alert icon={<IconAlertCircle size={16} />} color="yellow">
            <Stack gap="xs">
              <Text fw={500}>Large Dataset Warning</Text>
              <Text size="sm">
                You're exporting {stats.totalRows.toLocaleString()} rows (~
                {stats.estimatedSize}). This may consume significant memory and
                take several minutes.
              </Text>
              <Text size="sm" c="dimmed">
                Note: The current implementation loads the entire export into
                memory before writing. Consider exporting fewer tables or
                implementing row limits if you encounter issues.
              </Text>
            </Stack>
          </Alert>
        )}

        <Card withBorder p="md">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Structure Options
            </Text>
            <Text size="xs" c="dimmed">
              Configure how table structures are exported
            </Text>
            <Divider />
            <Checkbox
              label="DROP TABLE statements"
              description="Drop existing tables before creating them"
              {...form.getInputProps('includeDrop', { type: 'checkbox' })}
            />
            <Checkbox
              label="CREATE TABLE statements"
              description="Include table structure (columns, types, keys)"
              {...form.getInputProps('includeCreate', { type: 'checkbox' })}
            />
          </Stack>
        </Card>

        <Card withBorder p="md">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Data Options
            </Text>
            <Text size="xs" c="dimmed">
              Choose how to export table data
            </Text>
            <Divider />
            <Radio.Group {...form.getInputProps('dataMode')}>
              <Stack gap="xs">
                <Radio
                  value={DataExportMode.NoData}
                  label="No Data"
                  description="Export structure only (empty tables)"
                />
                <Radio
                  value={DataExportMode.Insert}
                  label="INSERT statements"
                  description="Standard INSERT INTO for all rows"
                />
                <Radio
                  value={DataExportMode.Replace}
                  label="REPLACE statements"
                  description="Overwrite data if duplicates exist"
                />
                <Radio
                  value={DataExportMode.InsertIgnore}
                  label="INSERT IGNORE statements"
                  description="Skip errors on duplicate keys"
                />
              </Stack>
            </Radio.Group>
          </Stack>
        </Card>

        <Card withBorder p="md">
          <Stack gap="md">
            <div>
              <Text size="sm" fw={500}>
                Output Options
              </Text>
              <Text size="xs" c="dimmed">
                Configure export file and location
              </Text>
            </div>
            <Divider />

            <Select
              label="Export Format"
              description="Currently only SQL format is supported"
              data={[{ value: 'sql', label: 'SQL (.sql)' }]}
              {...form.getInputProps('exportFormat')}
              disabled
            />

            <TextInput
              label="File Name"
              placeholder="database_export.sql"
              required
              {...form.getInputProps('fileName')}
            />

            <Group align="flex-end" wrap="nowrap">
              <TextInput
                label="Output Folder"
                placeholder="Select folder..."
                required
                readOnly
                style={{ flex: 1 }}
                {...form.getInputProps('outputPath')}
                rightSection={
                  form.values.outputPath ? (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => form.setFieldValue('outputPath', '')}
                      title="Clear"
                    >
                      ×
                    </ActionIcon>
                  ) : null
                }
              />
              <Button onClick={handleSelectOutputPath}>Browse</Button>
            </Group>

            <NumberInput
              label="Max INSERT Size"
              description="Number of rows per INSERT statement (lower = smaller batches)"
              min={1}
              max={10000}
              required
              {...form.getInputProps('maxInsertSize')}
            />

            <div>
              <Group
                justify="space-between"
                style={{ cursor: 'pointer' }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <Text size="sm" fw={500}>
                  Advanced SQL Options
                </Text>
                <ActionIcon variant="subtle" size="sm">
                  {showAdvanced ? (
                    <IconChevronUp size={16} />
                  ) : (
                    <IconChevronDown size={16} />
                  )}
                </ActionIcon>
              </Group>

              <Collapse expanded={showAdvanced}>
                <Stack gap="xs" mt="xs">
                  <Checkbox
                    label="Add table locks"
                    description="Wrap INSERT statements with LOCK TABLES / UNLOCK TABLES"
                    {...form.getInputProps('addLocks', { type: 'checkbox' })}
                  />
                  <Checkbox
                    label="Disable foreign key checks"
                    description="Add SET FOREIGN_KEY_CHECKS=0/1 around the export"
                    {...form.getInputProps('disableForeignKeyChecks', {
                      type: 'checkbox',
                    })}
                  />
                  <Text size="xs" c="dimmed">
                    Note: These options are prepared for future backend
                    implementation.
                  </Text>
                </Stack>
              </Collapse>
            </div>
          </Stack>
        </Card>

        <Card withBorder p="md">
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={500}>
                  Select Tables
                </Text>
                <Text size="xs" c="dimmed">
                  Choose which tables to include in the export
                </Text>
              </div>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="light"
                  onClick={handleSelectAllTables}
                >
                  Select All
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={handleDeselectAllTables}
                >
                  Deselect All
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={loadTableStats}
                  loading={isLoadingStats}
                >
                  Load Stats
                </Button>
              </Group>
            </Group>

            {form.errors.selectedTables && (
              <Alert color="red" p="xs">
                {form.errors.selectedTables}
              </Alert>
            )}

            <Divider />

            <ScrollArea h={250}>
              <Stack gap="xs">
                {tables && tables.length > 0 ? (
                  tables.map((table) => {
                    const stat = tableStats.find((s) => s.name === table);
                    return (
                      <Group
                        key={table}
                        justify="space-between"
                        wrap="nowrap"
                      >
                        <Checkbox
                          label={table}
                          checked={form.values.selectedTables.includes(table)}
                          onChange={() => handleToggleTable(table)}
                        />
                        {stat && (
                          <Group gap="xs">
                            <Badge size="sm" variant="light" color="blue">
                              {stat.rowCount.toLocaleString()} rows
                            </Badge>
                            <Badge size="sm" variant="light" color="gray">
                              ~{stat.estimatedSize}
                            </Badge>
                          </Group>
                        )}
                      </Group>
                    );
                  })
                ) : (
                  <Text c="dimmed" size="sm">
                    No tables available
                  </Text>
                )}
              </Stack>
            </ScrollArea>

            {tableStats.length > 0 &&
              form.values.selectedTables.length > 0 && (
                <>
                  <Divider />
                  <Card bg="gray.0" p="sm">
                    <Group justify="space-between">
                      <Text size="sm" fw={500}>
                        Export Summary
                      </Text>
                      <Group gap="md">
                        <div>
                          <Text size="xs" c="dimmed">
                            Tables
                          </Text>
                          <Text size="sm" fw={500}>
                            {stats.totalTables}
                          </Text>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed">
                            Total Rows
                          </Text>
                          <Text size="sm" fw={500}>
                            {stats.totalRows.toLocaleString()}
                          </Text>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed">
                            Est. Size
                          </Text>
                          <Text size="sm" fw={500}>
                            {stats.estimatedSize}
                          </Text>
                        </div>
                      </Group>
                    </Group>
                  </Card>
                </>
              )}
          </Stack>
        </Card>

        <Group justify="flex-end" mt="md">
          <Button variant="light" onClick={onSuccess} disabled={isExporting}>
            Cancel
          </Button>
          <Button type="submit" loading={isExporting}>
            Export Database
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
