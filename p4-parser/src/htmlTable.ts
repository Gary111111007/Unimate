import { htmlToText } from './normalize.ts';

export interface HtmlTable {
  headers: string[];
  rows: Record<string, string>[];
  tableCount: number;
}

interface RawRow { html: string; cells: string[] }

function extractTables(html: string): string[] {
  const tables: string[] = [];
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) tables.push(m[0]);
  return tables;
}

function parseCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const attrs = m[1] || '';
    const text = htmlToText(m[2] || '');
    const colspan = Math.max(1, Math.min(8, Number((attrs.match(/\bcolspan\s*=\s*["']?(\d+)/i) || [])[1] || 1)));
    for (let i = 0; i < colspan; i++) cells.push(i === 0 ? text : '');
  }
  return cells;
}

function parseRows(tableHtml: string): RawRow[] {
  const rows: RawRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const cells = parseCells(m[1] || '');
    if (cells.some((cell) => cell.length > 0)) rows.push({ html: m[1] || '', cells });
  }
  return rows;
}

function headerIndex(rows: RawRow[]): number {
  const th = rows.findIndex((row) => /<th\b/i.test(row.html));
  if (th >= 0) return th;
  return rows.findIndex((row) => row.cells.length > 0);
}

export function parseHtmlTable(html: string): HtmlTable {
  const tables = extractTables(String(html || ''));
  const rows: RawRow[] = [];
  for (const table of tables) rows.push(...parseRows(table));
  const hIndex = headerIndex(rows);
  if (hIndex < 0) return { headers: [], rows: [], tableCount: tables.length };

  const headers = rows[hIndex].cells.map((header, index) => header || '列' + String(index + 1));
  const dataRows: Record<string, string>[] = [];
  for (const row of rows.slice(hIndex + 1)) {
    if (/<th\b/i.test(row.html)) continue;
    const record: Record<string, string> = {};
    for (let i = 0; i < row.cells.length; i++) {
      const key = headers[i] || '列' + String(i + 1);
      const value = row.cells[i];
      if (value && key) record[key] = value;
    }
    if (Object.keys(record).length) dataRows.push(record);
  }
  return { headers, rows: dataRows, tableCount: tables.length };
}
