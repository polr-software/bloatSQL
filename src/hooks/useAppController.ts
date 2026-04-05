import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  useConnections,
  useActiveConnection,
  useConnectionLoading,
  useLoadConnections,
  useConnectToDatabase,
  useDisconnectFromDatabase,
  useDeleteConnection,
  usePingMs,
  useMeasurePing,
  type Connection,
} from '../connections';
import {
  useQueryResults,
  useIsExecuting,
  useQueryError,
  useExecuteQuery,
  useClearQueryError,
  useSelectTable,
  useRefreshTable,
  useQueryExecutionStore,
} from '../stores/queryExecutionStore';
import {
  useTables,
  useIsLoadingTables,
  useDatabases,
  useCurrentDatabase,
  useIsLoadingDatabases,
  useLoadDatabases,
  useChangeDatabase,
  useResetDatabaseState,
} from '../stores/databaseBrowserStore';
import { useQueryText, useSetQueryText } from '../stores/queryEditorStore';
import {
  useExportError,
  useExportSuccessMessage,
  useClearExportError,
  useClearExportSuccess,
} from '../stores/exportStore';
import { useSetSelectedTable as useSetTableViewSelected } from '../stores/tableViewStore';
import { useStructureEditStore } from '../stores/structureEditStore';
import { useEditCellStore } from '../stores/editCellStore';
import { useAddQueryHistoryItem, useQueryHistory } from '../stores/queryHistoryStore';
import { tauriCommands } from '../tauri/commands';
import { useNavigationHistory } from './useNavigationHistory';

export function useAppController() {
  const connections = useConnections();
  const activeConnection = useActiveConnection();
  const connectionLoading = useConnectionLoading();
  const loadConnections = useLoadConnections();
  const connectToDatabase = useConnectToDatabase();
  const disconnectFromDatabase = useDisconnectFromDatabase();
  const deleteConnection = useDeleteConnection();

  const pingMs = usePingMs();
  const measurePing = useMeasurePing();

  const queryText = useQueryText();
  const setQueryText = useSetQueryText();
  const results = useQueryResults();
  const isExecuting = useIsExecuting();
  const queryError = useQueryError();
  const tables = useTables();
  const isLoadingTables = useIsLoadingTables();
  const executeQuery = useExecuteQuery();
  const selectTable = useSelectTable();
  const clearError = useClearQueryError();
  const databases = useDatabases();
  const currentDatabase = useCurrentDatabase();
  const isLoadingDatabases = useIsLoadingDatabases();
  const loadDatabases = useLoadDatabases();
  const changeDatabase = useChangeDatabase();
  const resetDatabaseState = useResetDatabaseState();
  const refreshTable = useRefreshTable();

  const exportError = useExportError();
  const successMessage = useExportSuccessMessage();
  const clearExportError = useClearExportError();
  const clearSuccess = useClearExportSuccess();

  const queryHistory = useQueryHistory();
  const addQueryHistoryItem = useAddQueryHistoryItem();

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const setTableViewSelected = useSetTableViewSelected();

  const navigationHistory = useNavigationHistory<string>(
    (tableName) => {
      setSelectedTable(tableName);
      setTableViewSelected(tableName);
      void selectTable(tableName);
    },
    (a, b) => a === b
  );

  const [
    connectionFormOpened,
    { open: openConnectionForm, close: closeConnectionForm },
  ] = useDisclosure(false);
  const [
    exportModalOpened,
    { open: openExportModal, close: closeExportModal },
  ] = useDisclosure(false);

  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [exportRowData, setExportRowData] = useState<
    Record<string, unknown> | Record<string, unknown>[] | undefined
  >(undefined);

  useEffect(() => {
    void tauriCommands.closeSplashscreen();
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (activeConnection) {
      void loadDatabases();
    }
  }, [activeConnection, loadDatabases]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F5' || !activeConnection) return;

      event.preventDefault();
      void refreshTable();
      notifications.show({
        title: 'Odswiezanie',
        message: 'Dane zostaly odswiezone',
        color: 'blue',
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeConnection, refreshTable]);

  useEffect(() => {
    if (!successMessage) return;

    notifications.show({
      title: 'Success',
      message: successMessage,
      color: 'green',
    });
    clearSuccess();
  }, [successMessage, clearSuccess]);

  useEffect(() => {
    if (!exportError) return;

    notifications.show({
      title: 'Error',
      message: exportError,
      color: 'red',
    });
    clearExportError();
  }, [exportError, clearExportError]);

  const resetEditingState = useCallback(() => {
    setSelectedTable(null);
    setTableViewSelected(null);
    useStructureEditStore.getState().stopEditing();
    useEditCellStore.getState().clearSelection();
    useEditCellStore.getState().stopAddRow();
  }, [setTableViewSelected]);

  const handleExecute = useCallback(async () => {
    if (!activeConnection) return;

    await executeQuery();

    const { lastExecutionTime } = useQueryExecutionStore.getState();
    if (lastExecutionTime !== null) {
      addQueryHistoryItem(queryText, lastExecutionTime);
    }
  }, [activeConnection, addQueryHistoryItem, executeQuery, queryText]);

  const handleConnect = useCallback(
    async (connection: Connection) => {
      try {
        await connectToDatabase(connection);
      } catch (error) {
        console.error('Failed to connect:', error);
      }
    },
    [connectToDatabase]
  );

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectFromDatabase();
      resetDatabaseState();
      resetEditingState();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  }, [disconnectFromDatabase, resetDatabaseState, resetEditingState]);

  const handleRefreshConnection = useCallback(async () => {
    if (!activeConnection) return;
    await Promise.all([loadDatabases(), measurePing()]);
  }, [activeConnection, loadDatabases, measurePing]);

  const handleDatabaseChange = useCallback(
    async (database: string) => {
      try {
        await changeDatabase(database);
        resetEditingState();
      } catch (error) {
        console.error('Failed to change database:', error);
      }
    },
    [changeDatabase, resetEditingState]
  );

  const handleDeleteConnection = useCallback(
    async (id: string) => {
      if (!confirm('Are you sure you want to delete this connection?')) {
        return;
      }

      try {
        await deleteConnection(id);
        await loadConnections();
      } catch (error) {
        console.error('Failed to delete connection:', error);
      }
    },
    [deleteConnection, loadConnections]
  );

  const handleEditConnection = useCallback(
    (connection: Connection) => {
      setEditingConnection(connection);
      openConnectionForm();
    },
    [openConnectionForm]
  );

  const handleCloseConnectionForm = useCallback(() => {
    closeConnectionForm();
    setEditingConnection(null);
    void loadConnections();
  }, [closeConnectionForm, loadConnections]);

  const handleConnectionFormSuccess = useCallback(() => {
    closeConnectionForm();
    setEditingConnection(null);
    void loadConnections();
  }, [closeConnectionForm, loadConnections]);

  const handleTableSelect = useCallback(
    (tableName: string) => {
      setSelectedTable(tableName);
      setTableViewSelected(tableName);
      void selectTable(tableName);
      navigationHistory.push(tableName);
    },
    [navigationHistory, selectTable, setTableViewSelected]
  );

  const handleOpenExportModalWithRow = useCallback(
    (rowData?: Record<string, unknown> | Record<string, unknown>[]) => {
      setExportRowData(rowData);
      openExportModal();
    },
    [openExportModal]
  );

  const handleCloseExportModal = useCallback(() => {
    closeExportModal();
    setExportRowData(undefined);
  }, [closeExportModal]);

  const isConnected = useMemo(() => !!activeConnection, [activeConnection]);

  return {
    connections,
    activeConnection,
    connectionLoading,
    pingMs,
    queryText,
    results,
    isExecuting,
    queryError,
    tables,
    isLoadingTables,
    databases,
    currentDatabase,
    isLoadingDatabases,
    selectedTable,
    queryHistory,
    connectionFormOpened,
    exportModalOpened,
    editingConnection,
    exportRowData,
    isConnected,
    navigationHistory,
    clearError,
    setQueryText,
    openConnectionForm,
    openExportModal,
    handleExecute,
    handleConnect,
    handleDisconnect,
    handleEditConnection,
    handleDeleteConnection,
    handleTableSelect,
    handleDatabaseChange,
    handleRefreshConnection,
    handleCloseConnectionForm,
    handleConnectionFormSuccess,
    handleOpenExportModalWithRow,
    handleCloseExportModal,
  };
}
