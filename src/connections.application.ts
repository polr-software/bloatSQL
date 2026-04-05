import type { Connection, ConnectionDraft } from './connections.domain';

export interface ConnectionsRepository {
  getConnections: () => Promise<Connection[]>;
  saveConnection: (connection: ConnectionDraft) => Promise<Connection>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (connection: Connection) => Promise<void>;
  connectToDatabase: (connection: Connection) => Promise<void>;
  disconnectFromDatabase: () => Promise<void>;
  pingConnection: () => Promise<number>;
}

export async function loadConnectionsUseCase(
  repository: ConnectionsRepository
): Promise<Connection[]> {
  return repository.getConnections();
}

export async function saveConnectionUseCase(
  repository: ConnectionsRepository,
  connection: ConnectionDraft
): Promise<Connection> {
  return repository.saveConnection(connection);
}

export async function deleteConnectionUseCase(
  repository: ConnectionsRepository,
  id: string
): Promise<void> {
  await repository.deleteConnection(id);
}

export async function testConnectionUseCase(
  repository: ConnectionsRepository,
  connection: Connection
): Promise<void> {
  await repository.testConnection(connection);
}

export async function connectToDatabaseUseCase(
  repository: ConnectionsRepository,
  connection: Connection
): Promise<{ activeConnection: Connection; pingMs: number | null }> {
  await repository.connectToDatabase(connection);

  try {
    const pingMs = await repository.pingConnection();
    return { activeConnection: connection, pingMs };
  } catch {
    return { activeConnection: connection, pingMs: null };
  }
}

export async function disconnectFromDatabaseUseCase(
  repository: ConnectionsRepository
): Promise<void> {
  await repository.disconnectFromDatabase();
}

export async function measureConnectionPingUseCase(
  repository: ConnectionsRepository
): Promise<number | null> {
  try {
    return await repository.pingConnection();
  } catch {
    return null;
  }
}
