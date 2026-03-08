import { ReactNode, useEffect } from 'react';
import { MantineProvider, createTheme, useMantineColorScheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import { TauriProvider } from './tauri/TauriProvider';
import { ErrorBoundary } from './components/modals';
import { useColorScheme, useSettingsStore } from './stores/settingsStore';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';

function ColorSchemeSync() {
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useColorScheme();

  useEffect(() => {
    setColorScheme(colorScheme);
  }, [colorScheme, setColorScheme]);

  return null;
}

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const { primaryColor, colorScheme, defaultRadius } = useSettingsStore();

  const theme = createTheme({
    primaryColor,
    defaultRadius,
    components: {
      Tooltip: {
        defaultProps: {
          bg: 'var(--mantine-color-default)',
          arrowSize: 8,
        },
        styles: {
          tooltip: {
            border: '1px solid var(--mantine-color-default-border)',
            color: 'var(--mantine-color-text)',
          },
          arrow: {
            border: '1px solid var(--mantine-color-default-border)',
          },
        },
      },
    },
  });

  return (
    <TauriProvider>
      <MantineProvider theme={theme} defaultColorScheme={colorScheme}>
        <DatesProvider settings={{ firstDayOfWeek: 1 }}>
          <ColorSchemeSync />
          <Notifications position="top-right" />
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </DatesProvider>
      </MantineProvider>
    </TauriProvider>
  );
}
