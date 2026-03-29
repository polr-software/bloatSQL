import { memo, useState } from 'react';
import { Stack, Center, Loader, AppShell, Button, Text, Box, ActionIcon, Group, Card, ScrollArea, TextInput, SegmentedControl, Code, Badge, rem, Paper } from '@mantine/core';
import { IconPlus, IconDatabase, IconEdit, IconTrash, IconPlug, IconSearch, IconTable, IconHistory } from '@tabler/icons-react';
import { Connection } from '../../../types/database';
import { QueryHistoryItem } from '../../../stores/queryHistoryStore';
import { DatabaseTree } from './DatabaseTree';
import { DatabaseSelector } from './DatabaseSelector';
import styles from "./Navbar.module.css";

interface NavbarProps {
  connections: Connection[];
  activeConnection: Connection | null;
  tables: string[] | null;
  databases: string[];
  currentDatabase: string;
  connectionLoading: boolean;
  isLoadingTables: boolean;
  isLoadingDatabases: boolean;
  selectedTable: string | null;
  queryHistory: QueryHistoryItem[];
  pingMs: number | null;
  onNewConnection: () => void;
  onConnect: (connection: Connection) => void;
  onDisconnect: () => void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (id: string) => void;
  onSelectTable: (tableName: string) => void;
  onDatabaseChange: (database: string) => void;
  onLoadQuery: (query: string) => void;
  onRefresh: () => void;
}

function NavbarComponent({
  connections,
  activeConnection,
  tables,
  databases,
  currentDatabase,
  connectionLoading,
  isLoadingTables,
  isLoadingDatabases,
  selectedTable,
  queryHistory,
  pingMs,
  onNewConnection,
  onConnect,
  onDisconnect,
  onEditConnection,
  onDeleteConnection,
  onSelectTable,
  onDatabaseChange,
  onLoadQuery,
  onRefresh,
}: NavbarProps) {
  const [tableSearch, setTableSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'tables' | 'history'>('tables');

  if (connectionLoading) {
    return (
      <Stack h="100%" justify="center" align="center">
        <Center>
          <Loader size="sm" />
        </Center>
      </Stack>
    );
  }

  const isConnected = !!activeConnection;
  const bubbles = Array.from({ length: 8 });

  return (
    <>
      <AppShell.Section mb="md">
        {!isConnected ? (
          <Button
            fullWidth
            leftSection={<IconPlus size={16} />}
            onClick={onNewConnection}
          >
            New Connection
          </Button>
        ) : (
          <DatabaseSelector
            activeConnection={activeConnection}
            databases={databases}
            currentDatabase={currentDatabase}
            isLoadingDatabases={isLoadingDatabases}
            pingMs={pingMs}
            onDatabaseChange={onDatabaseChange}
            onDisconnect={onDisconnect}
            onRefresh={onRefresh}
            onEdit={() => activeConnection && onEditConnection(activeConnection)}
          />
        )}
      </AppShell.Section>

      {isConnected && currentDatabase && (
        <>
          <AppShell.Section mb="sm">
            <TextInput
              placeholder="Search tables..."
              leftSection={<IconSearch size={16} />}
              value={tableSearch}
              onChange={(e) => setTableSearch(e.currentTarget.value)}
              size="xs"
            />
          </AppShell.Section>

          <AppShell.Section mb="md">
            <SegmentedControl
              fullWidth
              size="xs"
              value={activeTab}
              onChange={(value) => setActiveTab(value as 'tables' | 'history')}
              data={[
                {
                  value: 'tables',
                  label: (
                    <Center style={{ gap: 10 }}>
                      <IconTable size={14} />
                      <span>Tables</span>
                    </Center>
                  ),
                },
                {
                  value: 'history',
                  label: (
                    <Center style={{ gap: 10 }}>
                      <IconHistory size={14} />
                      <span>History</span>
                    </Center>
                  ),
                },
              ]}
            />
          </AppShell.Section>
        </>
      )}

      <AppShell.Section
        grow
        component={ScrollArea}
        type="hover"
        viewportProps={{ style: { overflowX: 'hidden' } }}
      >
        {isConnected ? (
          currentDatabase ? (
            activeTab === 'tables' ? (
              <DatabaseTree
                tables={tables}
                isLoadingTables={isLoadingTables}
                isConnected={isConnected}
                selectedTable={selectedTable}
                onSelectTable={onSelectTable}
                searchQuery={tableSearch}
              />
            ) : (
              <Stack gap="xs">
                {queryHistory.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="xl">
                    No query history yet
                  </Text>
                ) : (
                  queryHistory.map((item, idx) => (
                    <Card
                      key={idx}
                      p="xs"
                      withBorder
                      style={{ cursor: 'pointer' }}
                      onClick={() => onLoadQuery(item.query)}
                    >
                      <Stack gap={4}>
                        <Code
                          block
                          style={{
                            fontSize: rem(11),
                            maxHeight: rem(60),
                            overflow: 'hidden',
                          }}
                        >
                          {item.query.slice(0, 100)}
                          {item.query.length > 100 && '...'}
                        </Code>
                        <Group gap="xs" justify="space-between">
                          <Text size="xs" c="dimmed">
                            {item.timestamp.toLocaleTimeString()}
                          </Text>
                          <Badge size="xs" variant="light">
                            {item.executionTime}ms
                          </Badge>
                        </Group>
                      </Stack>
                    </Card>
                  ))
                )}
              </Stack>
            )
          ) : (
            <Center h={100}>
              <Text size="sm" c="dimmed" ta="center">
                Select a database to view tables
              </Text>
            </Center>
          )
        ) : (
          <Stack gap="sm">
            {connections.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                No saved connections
              </Text>
            ) : (
              connections.map((conn) => (
                <Card key={conn.id} withBorder padding="sm">
                  <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="xs" style={{ minWidth: 0 }}>
                        <IconDatabase size={18} />
                        <Text size="sm" fw={500} truncate>
                          {conn.name}
                        </Text>
                      </Group>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditConnection(conn);
                          }}
                        >
                          <IconEdit size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="red"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConnection(conn.id);
                          }}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>

                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {conn.username}@{conn.host}:{conn.port}
                    </Text>

                    <Button
                      size="xs"
                      variant="light"
                      fullWidth
                      leftSection={<IconPlug size={14} />}
                      onClick={() => onConnect(conn)}
                    >
                      Connect
                    </Button>
                  </Stack>
                </Card>
              ))
            )}
          </Stack>
        )}
      </AppShell.Section>
      <AppShell.Section>
        <Paper
          withBorder
          p="sm"
          component={Group}
          gap="xs"
          pos="relative"
          style={{ overflow: 'hidden' }}
        >
          {bubbles.map((_, i) => (
            <Box
              key={i}
              className={styles.bubble}
              style={{
                '--x': `${Math.random() * 100}%`,
                '--size': `${8 + Math.random() * 16}px`,
                '--duration': `${3 + Math.random() * 4}s`,
                '--delay': `${Math.random() * 3}s`,
                '--drift': `${(Math.random() - 0.5) * 40}px`,
              } as React.CSSProperties}
            />
          ))}

          <Box flex={1} style={{ zIndex: 1 }}>
            <Text fw={500} lh={1.3}>Keep It Alive</Text>
            <Text size="xs" c="dimmed">Help BloatSQL keep swimming.</Text>
          </Box>

          <Button disabled style={{ zIndex: 1 }}>Donate</Button>
        </Paper>
      </AppShell.Section>
    </>
  );
}

export const Navbar = memo(NavbarComponent);
export { DatabaseTree } from './DatabaseTree';
export { DatabaseSelector } from './DatabaseSelector';
