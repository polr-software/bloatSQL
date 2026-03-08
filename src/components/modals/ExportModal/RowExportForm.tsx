import {
  Stack,
  Group,
  Radio,
  Button,
  Text,
  ScrollArea,
  Divider,
  Card,
  Alert,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { formatRows, RowExportFormat } from './formatters';

interface RowExportFormProps {
  rowData: Record<string, unknown> | Record<string, unknown>[];
  onSuccess: () => void;
}

export function RowExportForm({ rowData, onSuccess }: RowExportFormProps) {
  const [format, setFormat] = useState<RowExportFormat>('json');

  const rows: Record<string, unknown>[] = Array.isArray(rowData)
    ? rowData
    : [rowData];

  const handleExport = async () => {
    if (rows.length === 0) return;

    const content = formatRows(rows, format);
    const ts = new Date().getTime();

    const filterMap: Record<RowExportFormat, { name: string; extensions: string[] }> = {
      json: { name: 'JSON', extensions: ['json'] },
      csv: { name: 'CSV', extensions: ['csv'] },
      sql: { name: 'SQL', extensions: ['sql'] },
    };

    try {
      const filePath = await save({
        defaultPath: `row_export_${ts}.${format}`,
        filters: [filterMap[format]],
        title: 'Save Row Export',
      });

      if (!filePath) return;

      await invoke('write_text_file', { path: filePath, content });

      notifications.show({
        title: 'Success',
        message: `Row exported successfully to ${filePath}`,
        color: 'green',
      });

      setTimeout(() => onSuccess(), 2000);
    } catch (error) {
      notifications.show({
        title: 'Export Failed',
        message: String(error),
        color: 'red',
      });
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleExport();
      }}
    >
      <Stack gap="md">
        <Card withBorder p="md">
          <Stack gap="md">
            <div>
              <Text size="sm" fw={500}>
                Export Format
              </Text>
              <Text size="xs" c="dimmed">
                Choose the format for exporting this row
              </Text>
            </div>
            <Divider />
            <Radio.Group
              value={format}
              onChange={(value) => setFormat(value as RowExportFormat)}
            >
              <Stack gap="xs">
                <Radio
                  value="json"
                  label="JSON"
                  description="Export as JSON object"
                />
                <Radio
                  value="csv"
                  label="CSV"
                  description="Export as CSV row"
                />
                <Radio
                  value="sql"
                  label="SQL INSERT"
                  description="Export as SQL INSERT statement"
                />
              </Stack>
            </Radio.Group>
          </Stack>
        </Card>

        <Card withBorder p="md">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Preview
            </Text>
            <Divider />
            <ScrollArea h={200}>
              <Text
                size="xs"
                style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
              >
                {formatRows(rows, format, { limit: 10 })}
              </Text>
            </ScrollArea>
          </Stack>
        </Card>

        <Alert color="blue" title="Export Location">
          <Text size="sm">
            When you click Export Row, a save dialog will open where you can
            choose the file name and location.
          </Text>
        </Alert>

        <Group justify="flex-end" mt="md">
          <Button variant="light" onClick={onSuccess}>
            Cancel
          </Button>
          <Button type="submit">
            Export {rows.length === 1 ? 'Row' : `${rows.length} Rows`}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
