import { memo } from 'react';
import { Stack } from '@mantine/core';
import { type Connection } from '../../../connections';
import { TitleBar } from './TitleBar';

interface HeaderProps {
  activeConnection: Connection | null;
  onExecuteQuery: () => void;
  onOpenExportModal: () => void;
}

function HeaderComponent({
  activeConnection,
  onExecuteQuery,
  onOpenExportModal,
}: HeaderProps) {
  return (
    <Stack gap={0} w="100%">
      <TitleBar
        activeConnection={activeConnection}
        onExecuteQuery={onExecuteQuery}
        onOpenExportModal={onOpenExportModal}
      />
    </Stack>
  );
}

export const Header = memo(HeaderComponent);
