import { Paper, Stack, Group, Text, Badge, Button, ActionIcon, Code, Tooltip } from '@mantine/core';
import { IconArrowBack, IconX } from '@tabler/icons-react';
import { AlterColumnOperation } from '../../../types/tableStructure';
import { DatabaseType } from '../../../connections';
import { getOperationPreviewSQL } from '../utils/alterTableSqlBuilder';

interface PendingChangesPreviewProps {
  tableName: string;
  operations: AlterColumnOperation[];
  dbType: DatabaseType;
  onUndoOperation: (index: number) => void;
  onClearAll: () => void;
}

function getOperationBadge(type: AlterColumnOperation['type']) {
  switch (type) {
    case 'ADD_COLUMN':
      return { color: 'green', label: 'ADD' };
    case 'DROP_COLUMN':
      return { color: 'red', label: 'DROP' };
    case 'MODIFY_COLUMN':
      return { color: 'blue', label: 'MODIFY' };
    case 'RENAME_COLUMN':
      return { color: 'orange', label: 'RENAME' };
  }
}

function getOperationDescription(op: AlterColumnOperation): string {
  switch (op.type) {
    case 'ADD_COLUMN':
      return `Add column: ${op.newDefinition?.name}`;
    case 'DROP_COLUMN':
      return `Drop column: ${op.columnName}`;
    case 'MODIFY_COLUMN':
      return `Modify column: ${op.columnName}`;
    case 'RENAME_COLUMN':
      return `Rename: ${op.columnName} → ${op.newColumnName}`;
  }
}

export function PendingChangesPreview({
  tableName,
  operations,
  dbType,
  onUndoOperation,
  onClearAll,
}: PendingChangesPreviewProps) {
  if (operations.length === 0) {
    return null;
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={500} size="sm">
          Pending changes ({operations.length})
        </Text>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconX size={14} />}
          onClick={onClearAll}
        >
          Clear all
        </Button>
      </Group>

      <Stack gap="xs">
        {operations.map((op, index) => {
          const badge = getOperationBadge(op.type);
          const sql = getOperationPreviewSQL(tableName, op, dbType);

          return (
            <Paper key={index} p="xs" withBorder bg="var(--mantine-color-dark-6)">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  <Badge color={badge.color} size="sm" variant="filled">
                    {badge.label}
                  </Badge>
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" truncate>
                      {getOperationDescription(op)}
                    </Text>
                    <Tooltip label={sql} multiline maw={400}>
                      <Code
                        block
                        style={{
                          fontSize: '11px',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {sql}
                      </Code>
                    </Tooltip>
                  </Stack>
                </Group>
                <Tooltip label="Undo this operation">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={() => onUndoOperation(index)}
                  >
                    <IconArrowBack size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
