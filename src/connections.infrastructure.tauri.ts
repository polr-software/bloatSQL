import { invoke } from '@tauri-apps/api/core';
import type { ConnectionsRepository } from './connections.application';
import type { Connection, ConnectionDraft } from './connections.domain';

interface BackendConnection {
  id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl_mode: string;
}

function toBackendConnection(connection: ConnectionDraft): BackendConnection {
  return {
    id: connection.id || crypto.randomUUID(),
    name: connection.name,
    db_type: connection.dbType,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    ssl_mode: connection.sslMode,
  };
}

function toFrontendConnection(connection: BackendConnection): Connection {
  return {
    id: connection.id,
    name: connection.name,
    dbType: connection.db_type as Connection['dbType'],
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    sslMode: connection.ssl_mode as Connection['sslMode'],
  };
}

export const tauriConnectionsRepository: ConnectionsRepository = {
  async getConnections() {
    const rawConnections = await invoke<BackendConnection[]>('get_connections');
    return rawConnections.map(toFrontendConnection);
  },

  async saveConnection(connection) {
    const backendConnection = toBackendConnection(connection);
    await invoke('save_connection', { conn: backendConnection });
    return toFrontendConnection(backendConnection);
  },

  async deleteConnection(id) {
    await invoke('delete_connection', { id });
  },

  async testConnection(connection) {
    await invoke('test_connection', { conn: toBackendConnection(connection) });
  },

  async connectToDatabase(connection) {
    await invoke('connect_to_database', { conn: toBackendConnection(connection) });
  },

  async disconnectFromDatabase() {
    await invoke('disconnect_from_database');
  },

  async pingConnection() {
    return invoke<number>('ping_connection');
  },
};
