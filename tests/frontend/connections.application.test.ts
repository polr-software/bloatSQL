import { describe, expect, test } from 'bun:test';
import {
  connectToDatabaseUseCase,
  measureConnectionPingUseCase,
  type ConnectionsRepository,
} from '../../src/connections.application';
import { DatabaseType, type Connection } from '../../src/connections';

function createRepository(overrides: Partial<ConnectionsRepository> = {}): ConnectionsRepository {
  return {
    getConnections: async () => [],
    saveConnection: async (connection) => ({
      id: connection.id ?? 'generated-id',
      ...connection,
    }),
    deleteConnection: async () => {},
    testConnection: async () => {},
    connectToDatabase: async () => {},
    disconnectFromDatabase: async () => {},
    pingConnection: async () => 12,
    ...overrides,
  };
}

const connection: Connection = {
  id: 'conn-1',
  name: 'Primary DB',
  dbType: DatabaseType.PostgreSQL,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'secret',
  database: 'app',
  sslMode: 'preferred',
};

describe('connections.application', () => {
  test('returns active connection and measured ping after connect', async () => {
    const calls: string[] = [];
    const repository = createRepository({
      connectToDatabase: async () => {
        calls.push('connect');
      },
      pingConnection: async () => {
        calls.push('ping');
        return 27;
      },
    });

    const result = await connectToDatabaseUseCase(repository, connection);

    expect(calls).toEqual(['connect', 'ping']);
    expect(result).toEqual({
      activeConnection: connection,
      pingMs: 27,
    });
  });

  test('falls back to null ping when ping measurement fails after connect', async () => {
    const repository = createRepository({
      pingConnection: async () => {
        throw new Error('ping failed');
      },
    });

    const result = await connectToDatabaseUseCase(repository, connection);

    expect(result).toEqual({
      activeConnection: connection,
      pingMs: null,
    });
  });

  test('returns null from ping use-case when repository ping fails', async () => {
    const repository = createRepository({
      pingConnection: async () => {
        throw new Error('timeout');
      },
    });

    await expect(measureConnectionPingUseCase(repository)).resolves.toBeNull();
  });
});
