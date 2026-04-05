import { Select, Stack, Group, Text, Loader, Card, ThemeIcon, Tooltip, ActionIcon } from '@mantine/core';
import { IconDatabase, IconPlugOff, IconRefresh, IconPencil } from '@tabler/icons-react';
import { Led } from '@gfazioli/mantine-led';
import { type Connection } from '../../../connections';

interface DatabaseSelectorProps {
  activeConnection: Connection | null;
  databases: string[];
  currentDatabase: string;
  isLoadingDatabases: boolean;
  pingMs: number | null;
  onDatabaseChange: (database: string) => void;
  onDisconnect: () => void;
  onRefresh?: () => void;
  onEdit?: () => void;
}

export function DatabaseSelector({
  activeConnection,
  databases,
  currentDatabase,
  isLoadingDatabases,
  pingMs,
  onDatabaseChange,
  onDisconnect,
  onRefresh,
  onEdit,
}: DatabaseSelectorProps) {
  if (!activeConnection) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Card withBorder padding="xs">
        <Group justify="space-between" wrap="nowrap">
          
          <Group gap="xs" wrap="nowrap" flex={1} miw={0}>
            <Tooltip label={pingMs !== null ? `${pingMs} ms` : 'Measuring...'} position="top" withArrow>
              <ThemeIcon 
                size="lg" 
                color="green" 
                variant="light" 
                style={{ border: '1px solid var(--mantine-color-default-border)' }}
              >
                <IconDatabase size={20} />
              </ThemeIcon>
            </Tooltip>

            
            <Stack gap={0} flex={1} miw={0}>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={600} lineClamp={1}>
                  {activeConnection.name}
                </Text>
                <Led animate size="xs" animationType="pulse" animationDuration={3.5} />
              </Group>
              
              <Text size="xs" c="dimmed" lineClamp={1}>
                {activeConnection.username}@{activeConnection.host}
              </Text>
            </Stack>
          </Group>

          <ActionIcon.Group>
            <Tooltip label="Refresh" position="top" withArrow>
              <ActionIcon 
                variant="default" 
                size="md" 
                onClick={onRefresh}
                loading={isLoadingDatabases}
              >
                <IconRefresh size={16} stroke={1.5} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label="Edit" position="top" withArrow>
              <ActionIcon 
                variant="default" 
                size="md" 
                onClick={onEdit}
              >
                <IconPencil size={16} stroke={1.5} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label="Disconnect" position="top" withArrow>
              <ActionIcon 
                variant="default" 
                size="md" 
                color="red" 
                onClick={onDisconnect}
              >
                <IconPlugOff size={16} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          </ActionIcon.Group>
        </Group>
      </Card>
      
      <Select
        size="xs"
        placeholder={isLoadingDatabases ? 'Loading...' : 'Select database'}
        data={databases}
        value={currentDatabase || null}
        onChange={(value) => value && onDatabaseChange(value)}
        disabled={isLoadingDatabases}
        leftSection={isLoadingDatabases ? <Loader size={14} /> : <IconDatabase size={14} />}
        searchable
        nothingFoundMessage="No databases found"
        comboboxProps={{ withinPortal: true }}
      />
    </Stack>
  );
}
