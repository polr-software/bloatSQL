import { useRef } from 'react';
import { Group, Kbd, Stack, Menu, ActionIcon, Tooltip, Center, Text, Button } from '@mantine/core';
import { IconDatabase } from '@tabler/icons-react';
import { ErrorBoundary } from 'react-error-boundary';
import { MonacoSqlEditor, MonacoSqlEditorRef } from './MonacoSqlEditor';
import { SplitButton, SplitButtonMenuItem } from '../common';
import {
  useInjectBenchmarkData,
  useExecuteQueryText,
} from '../../stores/queryExecutionStore';

function EditorErrorFallback({ resetErrorBoundary }: { resetErrorBoundary: () => void }) {
  return (
    <Center h="100%" style={{ flexDirection: 'column', gap: 8 }}>
      <Text c="dimmed" size="sm">Editor failed to load</Text>
      <Button size="xs" variant="subtle" onClick={resetErrorBoundary}>Retry</Button>
    </Center>
  );
}

interface QueryEditorCardProps {
  query: string;
  onQueryChange: (query: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
  isConnected: boolean;
  editorHeight: number | string;
}

const BENCHMARK_SIZES = [1_000, 10_000, 50_000, 100_000];

export function QueryEditorCard({
  query,
  onQueryChange,
  onExecute,
  isExecuting,
  isConnected,
  editorHeight,
}: QueryEditorCardProps) {
  const injectBenchmarkData = useInjectBenchmarkData();
  const executeQueryText = useExecuteQueryText();
  const editorRef = useRef<MonacoSqlEditorRef>(null);

  const menuItems: SplitButtonMenuItem[] = [
    {
      label: 'Run All',
      onClick: onExecute,
    },
    {
      label: 'Run Selection',
      onClick: () => {
        const selected = editorRef.current?.getSelectedText() ?? '';
        if (selected.trim()) {
          executeQueryText(selected);
        }
      },
    },
  ];

  return (
    <Stack gap={0} style={{ height: editorHeight }}>
      <ErrorBoundary FallbackComponent={EditorErrorFallback}>
        <MonacoSqlEditor
          ref={editorRef}
          value={query}
          onChange={onQueryChange}
          onExecute={onExecute}
        />
      </ErrorBoundary>

      <Group justify="flex-end" px={'md'} py={4}>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Tooltip label="Load benchmark data" withArrow>
              <ActionIcon variant="subtle" size={30}>
                <IconDatabase size={14} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Mock data (frontend test)</Menu.Label>
            {BENCHMARK_SIZES.map((n) => (
              <Menu.Item key={n} onClick={() => injectBenchmarkData(n)}>
                {n.toLocaleString('pl-PL')} rows
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>

        <SplitButton
          label="Run Current"
          onClick={onExecute}
          menuItems={menuItems}
          size="xs"
          variant="default"
          rightSection={
            <Group gap={4}>
              <Kbd size={'xs'}>Ctrl</Kbd> <Kbd size={'xs'}>Enter</Kbd>
            </Group>
          }
          disabled={!isConnected || !query.trim()}
          loading={isExecuting}
        />
      </Group>
    </Stack>
  );
}
