import { useStore } from 'zustand';
import {
  getSchemaCacheKey,
  schemaStore,
  type SchemaCacheEntry,
  type SchemaStore,
} from './schemaStore.store';

export { getSchemaCacheKey, schemaStore };
export type { SchemaCacheEntry, SchemaStore };

export function useSchemaStore<T>(selector: (state: SchemaStore) => T): T {
  return useStore(schemaStore, selector);
}

export const useSchemaEntry = (cacheKey: string | null) =>
  useSchemaStore((state) => (cacheKey ? state.cache[cacheKey] ?? null : null));

export const useSchemaLoading = () => useSchemaStore((s) => s.isLoadingSchema);
export const useSchemaError = () => useSchemaStore((s) => s.error);
