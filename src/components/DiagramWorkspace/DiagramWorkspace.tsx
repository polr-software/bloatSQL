import { useEffect, useMemo } from 'react';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { ReactFlowProvider } from '@xyflow/react';

import { useConnectionStore } from '../../connections';
import { useDiagramStore } from '../../stores/diagramStore';
import { useCurrentDatabase } from '../../stores/databaseBrowserStore';
import {
  getSchemaCacheKey,
  useSchemaEntry,
  useSchemaError,
  useSchemaLoading,
  useSchemaStore,
} from '../../stores/schemaStore';
import { transformToReactFlow } from './utils/dataTransform';
import { getLayoutedElements } from './utils/layoutAlgorithms';
import { DiagramCanvas } from './DiagramCanvas';

export function DiagramWorkspace() {
  const activeConnection = useConnectionStore((s) => s.activeConnection);
  const currentDatabase = useCurrentDatabase();
  const schemaCacheKey = getSchemaCacheKey(activeConnection?.id, currentDatabase);

  const nodes = useDiagramStore((s) => s.nodes);
  const showColumnTypes = useDiagramStore((s) => s.showColumnTypes);
  const showOnlyKeys = useDiagramStore((s) => s.showOnlyKeys);
  const setNodes = useDiagramStore((s) => s.setNodes);
  const setEdges = useDiagramStore((s) => s.setEdges);
  const setError = useDiagramStore((s) => s.setError);

  const schemaEntry = useSchemaEntry(schemaCacheKey);
  const isLoading = useSchemaLoading();
  const schemaError = useSchemaError();
  const loadFullSchema = useSchemaStore((s) => s.loadFullSchema);

  useEffect(() => {
    if (!schemaCacheKey) return;

    void loadFullSchema(schemaCacheKey).catch((error) => {
      console.error('Failed to load diagram data:', error);
    });
  }, [loadFullSchema, schemaCacheKey]);

  const transformedGraph = useMemo(() => {
    if (!schemaEntry) return null;

    const tableColumnsMap = new Map(
      Object.entries(schemaEntry.columnsByTable).map(([tableName, columns]) => [tableName, columns])
    );

    return transformToReactFlow(
      tableColumnsMap,
      schemaEntry.relationships,
      showColumnTypes,
      showOnlyKeys
    );
  }, [schemaEntry, showColumnTypes, showOnlyKeys]);

  useEffect(() => {
    if (!transformedGraph) {
      return;
    }

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      transformedGraph.nodes,
      transformedGraph.edges
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    setError(null);
  }, [setEdges, setError, setNodes, transformedGraph]);

  useEffect(() => {
    setError(schemaError);
  }, [schemaError, setError]);

  if (!activeConnection) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Text c="dimmed">Connect to a database to view the diagram</Text>
        </Stack>
      </Center>
    );
  }

  if (!currentDatabase) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Text c="dimmed">Select a database to view the diagram</Text>
        </Stack>
      </Center>
    );
  }

  if (isLoading && !schemaEntry) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Loading database schema...</Text>
        </Stack>
      </Center>
    );
  }

  if (schemaError) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Text c="red" fw={500}>
            Error loading diagram
          </Text>
          <Text c="dimmed" size="sm">
            {schemaError}
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!schemaEntry || schemaEntry.tables.length === 0 || nodes.length === 0) {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <Text c="dimmed">No tables found in the database</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <ReactFlowProvider>
      <DiagramCanvas />
    </ReactFlowProvider>
  );
}
