import { create } from 'zustand';
import {
  connectToDatabaseUseCase,
  deleteConnectionUseCase,
  disconnectFromDatabaseUseCase,
  loadConnectionsUseCase,
  measureConnectionPingUseCase,
  saveConnectionUseCase,
  testConnectionUseCase,
} from './connections.application';
import type { Connection, ConnectionDraft } from './connections.domain';
import { tauriConnectionsRepository } from './connections.infrastructure.tauri';

interface ConnectionState {
  connections: Connection[];
  activeConnection: Connection | null;
  isLoading: boolean;
  error: string | null;
  pingMs: number | null;
}

interface ConnectionActions {
  loadConnections: () => Promise<void>;
  saveConnection: (connection: ConnectionDraft) => Promise<Connection>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (connection: Connection) => Promise<void>;
  connectToDatabase: (connection: Connection) => Promise<void>;
  disconnectFromDatabase: () => Promise<void>;
  setActiveConnection: (connection: Connection | null) => void;
  clearError: () => void;
  measurePing: () => Promise<void>;
}

export type ConnectionStore = ConnectionState & ConnectionActions;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const repository = tauriConnectionsRepository;

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connections: [],
  activeConnection: null,
  isLoading: false,
  error: null,
  pingMs: null,

  loadConnections: async () => {
    set({ isLoading: true, error: null });
    try {
      const connections = await loadConnectionsUseCase(repository);
      set({ connections, isLoading: false });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to load connections'),
        isLoading: false,
      });
    }
  },

  saveConnection: async (connection) => {
    set({ isLoading: true, error: null });
    try {
      const savedConnection = await saveConnectionUseCase(repository, connection);

      set((state) => ({
        connections: state.connections.some((item) => item.id === savedConnection.id)
          ? state.connections.map((item) =>
              item.id === savedConnection.id ? savedConnection : item
            )
          : [...state.connections, savedConnection],
        isLoading: false,
      }));

      return savedConnection;
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to save connection'),
        isLoading: false,
      });
      throw error;
    }
  },

  deleteConnection: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await deleteConnectionUseCase(repository, id);
      set((state) => ({
        connections: state.connections.filter((connection) => connection.id !== id),
        activeConnection:
          state.activeConnection?.id === id ? null : state.activeConnection,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to delete connection'),
        isLoading: false,
      });
      throw error;
    }
  },

  testConnection: async (connection) => {
    set({ isLoading: true, error: null });
    try {
      await testConnectionUseCase(repository, connection);
      set({ isLoading: false });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Connection test failed'),
        isLoading: false,
      });
      throw error;
    }
  },

  connectToDatabase: async (connection) => {
    set({ isLoading: true, error: null });
    try {
      const result = await connectToDatabaseUseCase(repository, connection);
      set({
        activeConnection: result.activeConnection,
        pingMs: result.pingMs,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to connect'),
        isLoading: false,
      });
      throw error;
    }
  },

  disconnectFromDatabase: async () => {
    set({ isLoading: true, error: null });
    try {
      await disconnectFromDatabaseUseCase(repository);
      set({ activeConnection: null, isLoading: false, pingMs: null });
    } catch (error) {
      set({
        error: getErrorMessage(error, 'Failed to disconnect'),
        isLoading: false,
      });
      throw error;
    }
  },

  setActiveConnection: (connection) => {
    set({ activeConnection: connection });
  },

  clearError: () => {
    set({ error: null });
  },

  measurePing: async () => {
    const pingMs = await measureConnectionPingUseCase(repository);
    set({ pingMs });
  },
}));

export const useConnections = () => useConnectionStore((state) => state.connections);
export const useActiveConnection = () =>
  useConnectionStore((state) => state.activeConnection);
export const useConnectionLoading = () => useConnectionStore((state) => state.isLoading);
export const useConnectionError = () => useConnectionStore((state) => state.error);
export const useLoadConnections = () => useConnectionStore((state) => state.loadConnections);
export const useSaveConnection = () => useConnectionStore((state) => state.saveConnection);
export const useDeleteConnection = () => useConnectionStore((state) => state.deleteConnection);
export const useTestConnection = () => useConnectionStore((state) => state.testConnection);
export const useConnectToDatabase = () =>
  useConnectionStore((state) => state.connectToDatabase);
export const useDisconnectFromDatabase = () =>
  useConnectionStore((state) => state.disconnectFromDatabase);
export const useSetActiveConnection = () =>
  useConnectionStore((state) => state.setActiveConnection);
export const useClearConnectionError = () =>
  useConnectionStore((state) => state.clearError);
export const usePingMs = () => useConnectionStore((state) => state.pingMs);
export const useMeasurePing = () => useConnectionStore((state) => state.measurePing);
