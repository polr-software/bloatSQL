import { create } from 'zustand';

interface QueryEditorState {
  queryText: string;
}

interface QueryEditorActions {
  setQueryText: (text: string) => void;
}

type QueryEditorStore = QueryEditorState & QueryEditorActions;

export const useQueryEditorStore = create<QueryEditorStore>((set) => ({
  queryText: '',

  setQueryText: (text) => {
    set({ queryText: text });
  },
}));

export const useQueryText = () => useQueryEditorStore((s) => s.queryText);
export const useSetQueryText = () => useQueryEditorStore((s) => s.setQueryText);
