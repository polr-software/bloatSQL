import { DatabaseType } from '../connections';

export const QUERY_TIMEOUT_MS = 30_000;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

export function parseQueryStoreError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export function formatTableName(
  tableName: string,
  dbType: DatabaseType | undefined
): string {
  if (!dbType) return tableName;

  if (dbType === DatabaseType.PostgreSQL) {
    return `"${tableName}"`;
  }

  return `\`${tableName}\``;
}
