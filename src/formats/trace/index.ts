import type {
  CellValue,
  ColumnDefinition,
  ColumnStats,
  CsvFormatAdapter,
  DataRow,
  ParseContext,
  ParsedDataset,
} from '../../models/dataset';
import { defineColumns, detectDelimiter, parseCsv, toRows } from '../../services/csv';

const DAY_MS = 86_400_000;
const TIME_NAME = /^(時間|時刻|time)$/i;
const MSEC_NAME = /^(msec|ミリ秒|millisecond)$/i;
const CLOCK = /^(\d{1,3}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/;

/**
 * Trace CSV layout (a recording of roughly 30 seconds):
 *
 *   1  ,ログ日時,,号機番号,バージョン,      … metadata labels
 *   2  ,00/00/00, 00:03:16,0001,IH02-…,     … metadata values
 *   3  ,,,,位置,,,,,,衝突防止センサ(上),,,  … classification, repeats omitted
 *   4  時間,msec,アラーム,サブコード,…      … column names
 *   5+ 00:04:09,065,4364,0x01,…             … samples
 */
function locateHeaderRow(matrix: string[][]): number {
  const limit = Math.min(matrix.length, 15);
  for (let index = 0; index < limit; index += 1) {
    const cells = matrix[index].map((cell) => cell.trim());
    if (cells.some((cell) => TIME_NAME.test(cell)) && cells.some((cell) => MSEC_NAME.test(cell))) return index;
  }
  const scored = matrix.slice(0, limit)
    .map((row, index) => ({ index, score: scoreHeader(row) }))
    .sort((left, right) => right.score - left.score);
  return scored[0]?.index ?? 0;
}

function scoreHeader(row: string[]): number {
  const matches = (pattern: RegExp) => row.filter((cell) => pattern.test(cell)).length;
  return row.filter(Boolean).length
    + matches(/時間|時刻|date|time/i) * 4
    + matches(/msec|millisecond|ミリ秒/i) * 6
    - matches(/group|グループ/i) * 3;
}

/**
 * The classification row only names the first column of each block; the rest of
 * the block is left blank and inherits it. Writers also drop the blank tail, so
 * the row can be shorter than the header and the final block has to be carried
 * to the last column.
 */
function expandClassification(row: string[] = [], width = row.length): string[] {
  let current = '';
  return Array.from({ length: width }, (_, index) => {
    const label = (row[index] ?? '').trim();
    if (label) current = label;
    return current;
  });
}

/** Metadata labels may span several columns (ログ日時 covers the date and the time cell). */
function readHeadline(labels: string[] = [], values: string[] = []): Record<string, string> {
  const headline: Record<string, string> = {};
  let current = '';
  labels.forEach((cell, index) => {
    const label = cell.trim();
    if (label) current = label;
    const value = (values[index] ?? '').trim();
    if (!current || !value) return;
    headline[current] = headline[current] ? `${headline[current]} ${value}` : value;
  });
  return headline;
}

/** Clock cells hold a running HH:MM:SS; a full date is accepted as well. */
function timeOfDayMs(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const clock = CLOCK.exec(text);
  if (clock) {
    const [, hours, minutes, seconds, fraction] = clock;
    return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000
      + Number((fraction ?? '').padEnd(3, '0') || 0);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The recorder's clock drifts, and msec counts scans rather than milliseconds of
 * the current second, so neither cell locates a sample precisely. The seconds in
 * 時間 are trustworthy in aggregate — a 3,000 row file spans exactly 30 s — so
 * the samples are spread evenly over that span instead.
 */
function elapsedSeconds(rawRows: string[][], timeIndex: number, msecIndex: number): number[] | undefined {
  if (timeIndex < 0) return undefined;
  const wraps = CLOCK.test((rawRows[0]?.[timeIndex] ?? '').trim());
  const stamps: number[] = [];
  let offset = 0;
  let previous: number | undefined;

  for (const row of rawRows) {
    const clock = timeOfDayMs(row[timeIndex] ?? '');
    if (clock === undefined) return undefined;
    let stamp = clock + offset;
    if (wraps && previous !== undefined && stamp < previous) {
      offset += DAY_MS;
      stamp += DAY_MS;
    }
    previous = stamp;
    stamps.push(stamp);
  }

  const spanMs = stamps.at(-1)! - stamps[0];
  // Scaling the index before dividing keeps the final sample exactly on the span.
  if (stamps.length > 1 && spanMs > 0) return stamps.map((_, index) => (index * spanMs) / (stamps.length - 1) / 1000);

  // Too short to measure a period: fall back to the cells themselves.
  return stamps.map((stamp, index) => {
    const millis = msecIndex < 0 ? 0 : Number(rawRows[index][msecIndex] ?? 0);
    return (stamp - stamps[0] + (Number.isFinite(millis) ? millis : 0)) / 1000;
  });
}

/** Column titles carry their classification so 状態 or 検出エリア stay distinguishable. */
function classifiedNames(names: string[], classification: string[]): string[] {
  return names.map((name, index) => {
    const title = name.trim() || `Column ${index + 1}`;
    const block = classification[index];
    return block && block !== title ? `${block}-${title}` : title;
  });
}

function numericStats(values: number[]): ColumnStats {
  let changes = 0;
  for (let index = 1; index < values.length; index += 1) if (values[index] !== values[index - 1]) changes += 1;
  return {
    changes,
    missing: 0,
    unique: new Set(values).size,
    ...(values.length
      ? {
        min: Math.min(...values),
        max: Math.max(...values),
        average: values.reduce((total, value) => total + value, 0) / values.length,
      }
      : {}),
  };
}

/** Trailing separators leave an empty column that carries no header and no data. */
function usedWidth(headers: string[], rawRows: string[][]): number {
  let width = headers.length;
  while (width > 0
    && !(headers[width - 1] ?? '').trim()
    && rawRows.every((row) => !(row[width - 1] ?? '').trim())) width -= 1;
  return width;
}

function detectTrace(context: ParseContext): number {
  const head = context.text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(0, 12).join('\n');
  let confidence = 0;
  if (/^\s*時間\s*,\s*msec\s*,/m.test(head)) confidence += 0.45;
  else if (/msec/i.test(head) && /時間|時刻|time/i.test(head)) confidence += 0.3;
  if (/ログ日時/.test(head)) confidence += 0.2;
  if (/号機番号/.test(head)) confidence += 0.1;
  if (/バージョン/.test(head)) confidence += 0.05;
  if (/^\d{1,3}:\d{2}:\d{2},\d{1,3},/m.test(head)) confidence += 0.15;
  if (/trc[_-]?\d+/i.test(context.fileName)) confidence += 0.25;
  return Math.min(0.98, confidence);
}

function parseTrace(context: ParseContext, confidence = 0.8): ParsedDataset {
  const delimiter = detectDelimiter(context.text);
  const matrix = parseCsv(context.text.replace(/^\uFEFF/, ''), delimiter);
  if (matrix.length < 2) throw new Error('CSVにデータがありません。');

  const headerIndex = locateHeaderRow(matrix);
  const labelIndex = matrix.slice(0, Math.max(0, headerIndex - 1))
    .findIndex((row) => row.some((cell) => /ログ日時|号機番号|バージョン/.test(cell)));
  const valueIndex = labelIndex >= 0 ? labelIndex + 1 : -1;
  const classificationIndex = headerIndex - 1 > valueIndex ? headerIndex - 1 : -1;
  const headline = readHeadline(matrix[labelIndex], matrix[valueIndex]);

  const headers = matrix[headerIndex] ?? [];
  const rawRows = matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.trim()));
  if (rawRows.length === 0) throw new Error('トレースデータの行が見つかりません。');

  const width = usedWidth(headers, rawRows);
  const names = headers.slice(0, width);
  const samples = rawRows.map((row) => row.slice(0, width));
  const classification = expandClassification(matrix[classificationIndex], width);

  const columns: ColumnDefinition[] = defineColumns(classifiedNames(names, classification), samples, classification);
  let rows: DataRow[] = toRows(samples, columns);

  const timeIndex = names.findIndex((name) => TIME_NAME.test(name.trim()));
  const msecIndex = names.findIndex((name) => MSEC_NAME.test(name.trim()));
  const elapsed = elapsedSeconds(samples, timeIndex, msecIndex);

  let xAxis = timeIndex >= 0 ? columns[timeIndex] : undefined;
  let durationMs: number | undefined;

  if (elapsed) {
    const derived: ColumnDefinition = {
      id: '__elapsed',
      name: '経過時間',
      group: 'Time',
      unit: 's',
      type: 'number',
      stats: numericStats(elapsed),
    };
    columns.unshift(derived);
    rows = rows.map((row, index) => ({ ...row, [derived.id]: elapsed[index] as CellValue }));
    xAxis = derived;
    durationMs = (elapsed.at(-1)! - elapsed[0]) * 1000;
  }

  return {
    metadata: {
      fileName: context.fileName,
      formatId: 'trace',
      formatName: 'Trace CSV (trc)',
      confidence,
      delimiter,
      xAxisId: xAxis?.id,
      xAxisScale: 1,
      xAxisDisplayUnit: elapsed ? 's' : undefined,
      durationMs,
      details: {
        logTime: headline['ログ日時'] ?? '不明',
        machineNumber: headline['号機番号'] ?? '不明',
        version: headline['バージョン'] ?? '不明',
        startTime: (samples[0]?.[timeIndex] ?? '').trim() || '不明',
        sampleIntervalMs: elapsed && elapsed.length > 1
          ? Number(((elapsed[1] - elapsed[0]) * 1000).toFixed(3))
          : 'なし',
        classificationRow: classificationIndex >= 0 ? classificationIndex + 1 : 'なし',
        headerRow: headerIndex + 1,
        dataStartRow: headerIndex + 2,
      },
    },
    columns,
    rows,
  };
}

export const traceCsvFormat: CsvFormatAdapter = {
  id: 'trace',
  name: 'Trace CSV (trc)',
  detect: detectTrace,
  parse: parseTrace,
};

export const traceInternals = { classifiedNames, expandClassification, readHeadline, timeOfDayMs };
