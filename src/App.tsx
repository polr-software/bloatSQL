import { ConnectionModal } from './components/ConnectionManager';
import {
  Aside,
  AppLayout,
  Header,
  MainContent,
  Navbar,
} from './components/Layout';
import { ExportModal } from './components/modals';
import { useAppController } from './hooks/useAppController';

function App() {
  const {
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
  } = useAppController();

  return (
    <>
      <AppLayout
        header={
          <Header
            activeConnection={activeConnection}
            onExecuteQuery={handleExecute}
            onOpenExportModal={openExportModal}
          />
        }
        navbar={
          <Navbar
            connections={connections}
            activeConnection={activeConnection}
            tables={tables}
            databases={databases}
            currentDatabase={currentDatabase}
            connectionLoading={connectionLoading}
            isLoadingTables={isLoadingTables}
            isLoadingDatabases={isLoadingDatabases}
            selectedTable={selectedTable}
            queryHistory={queryHistory}
            pingMs={pingMs}
            onNewConnection={openConnectionForm}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onEditConnection={handleEditConnection}
            onDeleteConnection={handleDeleteConnection}
            onSelectTable={handleTableSelect}
            onDatabaseChange={handleDatabaseChange}
            onLoadQuery={setQueryText}
            onRefresh={handleRefreshConnection}
          />
        }
        aside={<Aside />}
        onNavigateBack={navigationHistory.canGoBack ? navigationHistory.goBack : undefined}
        onNavigateForward={navigationHistory.canGoForward ? navigationHistory.goForward : undefined}
      >
        <MainContent
          queryText={queryText}
          handleQueryChange={setQueryText}
          handleExecute={handleExecute}
          isExecuting={isExecuting}
          isConnected={isConnected}
          results={results}
          error={queryError}
          clearError={clearError}
          isTableTransitionPending={false}
          onOpenExportModal={handleOpenExportModalWithRow}
        />
      </AppLayout>

      <ConnectionModal
        opened={connectionFormOpened}
        onClose={handleCloseConnectionForm}
        onSuccess={handleConnectionFormSuccess}
        connection={editingConnection || undefined}
      />

      {activeConnection && currentDatabase && (
        <ExportModal
          opened={exportModalOpened}
          onClose={handleCloseExportModal}
          databaseName={currentDatabase}
          rowData={exportRowData}
        />
      )}
    </>
  );
}

export default App;
