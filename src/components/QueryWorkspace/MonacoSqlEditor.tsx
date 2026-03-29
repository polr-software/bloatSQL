import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { useMantineColorScheme } from '@mantine/core';
import { editor as monacoEditor, languages, IDisposable } from 'monaco-editor';
import { useTables } from '../../stores/databaseBrowserStore';
import { useTableColumnsMap } from '../../stores/tableMetadataStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { DatabaseType } from '../../types/database';
import { sqlSnippets, convertSnippetToCompletion } from './sql-snippets';

export interface MonacoSqlEditorRef {
  getSelectedText: () => string;
}

interface MonacoSqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  height?: string | number;
}

/**
 * Parse FROM/JOIN clauses to extract referenced tables and their aliases.
 * Returns Map<alias_or_table_name (lowercase) → canonical_table_name>.
 */
function parseReferencedTables(sql: string, availableTables: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const tableSet = new Set(availableTables.map((t) => t.toLowerCase()));
  const fromRegex = /(?:FROM|JOIN)\s+[`"]?(\w+)[`"]?\s*(?:AS\s+)?([a-zA-Z_]\w*)?/gi;
  let match;
  while ((match = fromRegex.exec(sql)) !== null) {
    const lower = match[1].toLowerCase();
    if (tableSet.has(lower)) {
      const canonical = availableTables.find((t) => t.toLowerCase() === lower)!;
      const alias = match[2] || canonical;
      result.set(alias.toLowerCase(), canonical);
      result.set(canonical.toLowerCase(), canonical);
    }
  }
  return result;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'DROP', 'ALTER', 'TABLE', 'DATABASE', 'INDEX',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'NULL', 'IS', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN',
  'SET', 'VALUES', 'INTO',
];

const SQL_FUNCTIONS = [
  { name: 'NOW()', detail: 'Current timestamp' },
  { name: 'COUNT(*)', detail: 'Count all rows' },
  { name: 'CONCAT()', detail: 'Concatenate strings' },
  { name: 'COALESCE()', detail: 'Return first non-NULL value' },
  { name: 'SUBSTRING()', detail: 'Extract substring' },
  { name: 'UPPER()', detail: 'Convert to uppercase' },
  { name: 'LOWER()', detail: 'Convert to lowercase' },
  { name: 'TRIM()', detail: 'Remove whitespace' },
  { name: 'LENGTH()', detail: 'String length' },
  { name: 'ROUND()', detail: 'Round number' },
  { name: 'DATE_FORMAT()', detail: 'Format date' },
  { name: 'IFNULL()', detail: 'Replace NULL values' },
  { name: 'CAST()', detail: 'Convert data type' },
];

function formatSql(sql: string): string {
  let formatted = sql.replace(/\s+/g, ' ').trim();

  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN',
    'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE', 'DROP', 'ALTER',
    'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
  ];

  keywords.forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    formatted = formatted.replace(regex, `\n${keyword}`);
  });

  formatted = formatted.replace(/\b(AND|OR)\b/gi, '\n  $1');

  formatted = formatted
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  if (!formatted.endsWith(';')) {
    formatted += ';';
  }

  return formatted;
}

export const MonacoSqlEditor = forwardRef<MonacoSqlEditorRef, MonacoSqlEditorProps>(
function MonacoSqlEditor({ value, onChange, onExecute, height = '100%' }, ref) {
  const { colorScheme } = useMantineColorScheme();
  const tables = useTables();
  const tableColumnsMap = useTableColumnsMap();
  const { activeConnection } = useConnectionStore();

  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Refs so providers always read the latest values without re-registration
  const tablesRef = useRef(tables);
  const tableColumnsMapRef = useRef(tableColumnsMap);
  const activeConnectionRef = useRef(activeConnection);

  const completionDisposableRef = useRef<IDisposable | null>(null);
  const formatterDisposableRef = useRef<IDisposable | null>(null);

  useEffect(() => { tablesRef.current = tables; }, [tables]);
  useEffect(() => { tableColumnsMapRef.current = tableColumnsMap; }, [tableColumnsMap]);
  useEffect(() => { activeConnectionRef.current = activeConnection; }, [activeConnection]);

  useImperativeHandle(ref, () => ({
    getSelectedText: () => {
      const editor = editorRef.current;
      if (!editor) return '';
      const selection = editor.getSelection();
      if (!selection) return '';
      return editor.getModel()?.getValueInRange(selection) ?? '';
    },
  }));

  const setupSqlProviders = (monaco: Monaco) => {
    // Dispose old providers before registering new ones
    completionDisposableRef.current?.dispose();
    formatterDisposableRef.current?.dispose();

    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const currentTables = tablesRef.current ?? [];
        const currentColumnsMap = tableColumnsMapRef.current;
        const isPostgres = activeConnectionRef.current?.dbType === DatabaseType.PostgreSQL;
        const quoteChar = isPostgres ? '"' : '`';

        // Full text before cursor for context detection
        const textBefore = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        // Context: user is typing `tableName.columnName` → suggest only that table's columns
        const dotMatch = textBefore.match(/(\w+)\.\w*$/);
        if (dotMatch) {
          const alias = dotMatch[1].toLowerCase();
          const referencedTables = parseReferencedTables(textBefore, currentTables);
          const canonical =
            referencedTables.get(alias) ??
            currentTables.find((t) => t.toLowerCase() === alias);
          if (canonical) {
            const cols = currentColumnsMap[canonical] ?? [];
            return {
              suggestions: cols.map((col) => ({
                label: col,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: col,
                range,
                detail: `${canonical}.${col}`,
              })),
            };
          }
        }

        const suggestions: languages.CompletionItem[] = [];

        // Keywords
        SQL_KEYWORDS.forEach((keyword) => {
          suggestions.push({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range,
            detail: 'SQL Keyword',
          });
        });

        // Table names (quoted + plain)
        currentTables.forEach((table) => {
          suggestions.push({
            label: table,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: `${quoteChar}${table}${quoteChar}`,
            range,
            detail: 'Table',
            documentation: `Table: ${table}`,
          });
          suggestions.push({
            label: `${table} (plain)`,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: table,
            range,
            detail: 'Table (unquoted)',
          });
        });

        // Columns from tables referenced in the current query's FROM/JOIN clauses
        const referencedTables = parseReferencedTables(textBefore, currentTables);
        const seenColumns = new Set<string>();
        referencedTables.forEach((canonical) => {
          const cols = currentColumnsMap[canonical] ?? [];
          cols.forEach((col) => {
            const key = `${canonical}.${col}`;
            if (seenColumns.has(key)) return;
            seenColumns.add(key);
            suggestions.push({
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col,
              range,
              detail: `Column: ${canonical}`,
            });
          });
        });

        // Functions
        SQL_FUNCTIONS.forEach(({ name, detail }) => {
          suggestions.push({
            label: name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: name,
            range,
            detail,
          });
        });

        // Snippets
        sqlSnippets.forEach((snippet) => {
          suggestions.push(convertSnippetToCompletion(snippet, range, monaco));
        });

        return { suggestions };
      },
    });

    formatterDisposableRef.current = monaco.languages.registerDocumentFormattingEditProvider('sql', {
      provideDocumentFormattingEdits: (model) => [
        { range: model.getFullModelRange(), text: formatSql(model.getValue()) },
      ],
    });
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    setupSqlProviders(monaco);

    monaco.languages.setLanguageConfiguration('sql', {
      comments: {
        lineComment: '--',
        blockComment: ['/*', '*/'],
      },
      brackets: [
        ['(', ')'],
        ['[', ']'],
      ],
      autoClosingPairs: [
        { open: '(', close: ')' },
        { open: '[', close: ']' },
        { open: "'", close: "'" },
        { open: '"', close: '"' },
        { open: '`', close: '`' },
      ],
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onExecute();
    });

    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        editor.getAction('editor.action.formatDocument')?.run();
      }
    );

    editor.focus();
  };

  // Cleanup providers on unmount
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
      formatterDisposableRef.current?.dispose();
    };
  }, []);

  return (
    <Editor
      height={height}
      defaultLanguage="sql"
      value={value}
      onChange={(newValue) => onChange(newValue || '')}
      onMount={handleEditorDidMount}
      theme={colorScheme === 'dark' ? 'vs-dark' : 'light'}
      options={{
        minimap: { enabled: false },
        fontSize: 16,
        fontFamily: 'JetBrains Mono, Consolas, Monaco, "Courier New", monospace',
        lineNumbers: 'on',
        renderLineHighlight: 'all',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'on',
        wrappingIndent: 'indent',
        formatOnPaste: true,
        formatOnType: true,
        suggestOnTriggerCharacters: true,
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        suggest: {
          showKeywords: true,
          showSnippets: true,
        },
        parameterHints: {
          enabled: true,
        },
        folding: true,
        foldingStrategy: 'indentation',
        showFoldingControls: 'mouseover',
        matchBrackets: 'always',
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        autoIndent: 'full',
        contextmenu: true,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
      loading={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          Loading editor...
        </div>
      }
    />
  );
});
