import { create } from 'zustand';

export interface QueryHistoryItem {
  query: string;
  timestamp: Date;
  executionTime: number;
}

interface QueryHistoryState {
  items: QueryHistoryItem[];
}

interface QueryHistoryActions {
  addItem: (query: string, executionTime: number) => void;
  clear: () => void;
}

type QueryHistoryStore = QueryHistoryState & QueryHistoryActions;

export const useQueryHistoryStore = create<QueryHistoryStore>((set) => ({
  items: [],

  addItem: (query, executionTime) => {
    set((state) => ({
      items: [
        {
          query,
          timestamp: new Date(),
          executionTime,
        },
        ...state.items,
      ].slice(0, 20),
    }));
  },

  clear: () => {
    set({ items: [] });
  },
}));

export const useQueryHistory = () => useQueryHistoryStore((s) => s.items);
export const useAddQueryHistoryItem = () => useQueryHistoryStore((s) => s.addItem);
