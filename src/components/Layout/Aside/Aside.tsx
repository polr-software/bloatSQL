import { memo } from 'react';
import { AppShell, Stack, Center, Text, ThemeIcon } from '@mantine/core';
import { IconEditCircle } from '@tabler/icons-react';
import { useIsEditingCell, useIsAddingRow } from '../../../stores/editCellStore';
import { useEditingColumnDraft, useIsAddingNewColumn, useIsEditingStructure } from '../../../stores/structureEditStore';
import { CellEditForm, AddRowForm } from '../../CellEditor';
import { ColumnEditForm, StructureEditControls } from '../../StructureEditor';

function EmptyState() {
  return (
<AppShell.Section grow>
      <Center h="100%">
        <Stack gap="xs" align="center">
          <ThemeIcon variant="light" size={50} >
            <IconEditCircle size={30} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={4} align="center">
            <Text fw={500} size="md" c="bright">
              Nothing to edit
            </Text>
            <Text c="dimmed" size="sm" ta="center">
              Click on a cell or column to start editing.
            </Text>
          </Stack>
        </Stack>
      </Center>
    </AppShell.Section>
  );
}

function AsideComponent() {
  const isEditingCell = useIsEditingCell();
  const isAddingRow = useIsAddingRow();
  const editingColumn = useEditingColumnDraft();
  const isAddingColumn = useIsAddingNewColumn();
  const isEditingStructure = useIsEditingStructure();

  if (isAddingColumn || editingColumn) {
    return (
      <>
        <ColumnEditForm />
        <StructureEditControls />
      </>
    );
  }

  if (isEditingStructure) {
    return (
      <>
        <AppShell.Section grow>
          <Center h="100%">
            <Stack gap="xs" align="center">
              <ThemeIcon variant="light" size={50} color="gray">
                <IconEditCircle size={30} stroke={1.5} />
              </ThemeIcon>
              <Stack gap={4} align="center">
                <Text fw={500} size="md" c="bright">
                  Structure editing mode
                </Text>
                <Text c="dimmed" size="sm" ta="center">
                  Click on a column to edit or use "Add column" button.
                </Text>
              </Stack>
            </Stack>
          </Center>
        </AppShell.Section>
        <StructureEditControls />
      </>
    );
  }

  if (isAddingRow) return <AddRowForm />;
  if (isEditingCell) return <CellEditForm />;
  return <EmptyState />;
}

export const Aside = memo(AsideComponent);
