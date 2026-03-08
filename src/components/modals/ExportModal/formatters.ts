export type RowExportFormat = 'json' | 'csv' | 'sql';

export function formatRows(
  rows: Record<string, unknown>[],
  format: RowExportFormat,
  options?: { limit?: number }
): string {
  const limit = options?.limit;
  const displayRows = limit ? rows.slice(0, limit) : rows;
  const truncated = limit ? rows.length > limit : false;

  switch (format) {
    case 'json':
      return formatJson(displayRows, truncated ? rows.length - displayRows.length : 0);
    case 'csv':
      return formatCsv(displayRows, truncated);
    case 'sql':
      return formatSql(displayRows, truncated ? rows.length - displayRows.length : 0);
  }
}

function formatJson(rows: Record<string, unknown>[], remaining: number): string {
  const data = rows.length === 1 ? rows[0] : rows;
  const json = JSON.stringify(data, null, 2);
  return remaining > 0 ? `${json}\n// ... ${remaining} more rows` : json;
}

function formatCsv(rows: Record<string, unknown>[], truncated: boolean): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]).join(',');
  const valueLines = rows.map((row) =>
    Object.values(row)
      .map((v) => {
        if (v === null) return 'NULL';
        if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
        return String(v);
      })
      .join(',')
  );
  const csv = [headers, ...valueLines].join('\n');
  return truncated ? `${csv}\n...` : csv;
}

function formatSql(rows: Record<string, unknown>[], remaining: number): string {
  const stmts = rows.map((row) => {
    const columns = Object.keys(row)
      .map((k) => `\`${k}\``)
      .join(', ');
    const values = Object.values(row)
      .map((v) => {
        if (v === null) return 'NULL';
        if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
        return String(v);
      })
      .join(', ');
    return `INSERT INTO table_name (${columns}) VALUES (${values});`;
  });
  const sql = stmts.join('\n');
  return remaining > 0 ? `${sql}\n-- ... ${remaining} more rows` : sql;
}
