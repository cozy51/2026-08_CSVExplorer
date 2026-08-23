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
/** A PLC address such as X00, Y9f or X0f～X08 labels its own column, nothing after it. */
const BIT_ADDRESS = /^[XY][0-9a-f]{2,3}(?:\s*[～~-]\s*[XY]?[0-9a-f]{2,3})?$/i;
/** Recorders sample on a round period; the measured one only has to pick it out. */
const SAMPLE_PERIODS_MS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 100, 125, 200, 250, 500, 1000, 2000, 5000];

interface TraceVariant { id: string; name: string; msec: boolean }

/**
 * Trace CSV layout (a recording of roughly 30 seconds):
 *
 *   1  ,ログ日時,,号機番号,バージョン,      … metadata labels
 *   2  ,00/00/00, 00:03:16,0001,IH02-…,     … metadata values
 *   3  ,,,,位置,,,,,,衝突防止センサ(上),,,  … classification, repeats omitted
 *   4  時間,msec,アラーム,サブコード,…      … column names
 *   5+ 00:04:09,065,4364,0x01,…             … samples
 *
 * The second variant of the same log has no msec column and keeps the
 * milliseconds in the clock instead:
 *
 *   4  時間,アラーム,サブコード,ポイント,…
 *   5+ 17:19:31.234,0000,0x00,00704,…
 */
const TRACE: TraceVariant = { id: 'trace', name: 'Trace CSV (trc)', msec: true };
const TRACE_2: TraceVariant = { id: 'trace2', name: 'Trace CSV 2 (msec無し)', msec: false };
const TIME_BASE_LABELS = {
  clock: '時間列のミリ秒',
  uniform: '時間列の秒差を行数で等分',
  cells: '時間列とmsec',
} as const;
/**
 * The header row names 時間; the row above it may do so as well, so it only
 * counts when the msec column follows or the next row already holds samples.
 */
function headerRowIndex(matrix: string[][]): number {
  const limit = Math.min(matrix.length, 15);
  for (let index = 0; index < limit; index += 1) {
    const cells = matrix[index].map((cell) => cell.trim());
    if (!cells.some((cell) => TIME_NAME.test(cell))) continue;
    if (cells.some((cell) => MSEC_NAME.test(cell))) return index;
    if (CLOCK.test((matrix[index + 1]?.[0] ?? '').trim())) return index;
  }
  return -1;
}

function locateHeaderRow(matrix: string[][]): number {
  const found = headerRowIndex(matrix);
  if (found >= 0) return found;
  const scored = matrix.slice(0, Math.min(matrix.length, 15))
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
    if (label) {
      // Addresses name a single column, so they must not run into the blanks
      // that follow — those columns simply have no classification.
      current = BIT_ADDRESS.test(label) ? '' : label;
      return label;
    }
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

type TimeBase = 'clock' | 'uniform' | 'cells';

/**
 * The recorder's clock drifts, and msec counts scans rather than milliseconds of
 * the current second, so in that variant neither cell locates a sample: the
 * seconds in 時間 are trustworthy in aggregate — a 3,000 row file spans exactly
 * 30 s — so the samples are spread evenly over that span. When the clock itself
 * carries milliseconds (17:19:31.234) it is precise enough to use as it stands.
 */
function elapsedSeconds(
  rawRows: string[][],
  timeIndex: number,
  msecIndex: number,
): { values: number[]; base: TimeBase } | undefined {
  if (timeIndex < 0) return undefined;
  const opening = CLOCK.exec((rawRows[0]?.[timeIndex] ?? '').trim());
  const wraps = Boolean(opening);
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

  if (opening?.[4]) {
    return { values: stamps.map((stamp) => Number(((stamp - stamps[0]) / 1000).toFixed(3))), base: 'clock' };
  }

  const spanMs = stamps.at(-1)! - stamps[0];
  if (stamps.length > 1 && spanMs > 0) {
    // Rounding the period keeps the axis readable: 0.01, 0.02, 0.03 … instead of
    // 0.010003334444814937.
    const period = tidyPeriod(spanMs / (stamps.length - 1));
    return { values: stamps.map((_, index) => Number(((index * period) / 1000).toFixed(6))), base: 'uniform' };
  }

  // Too short to measure a period: fall back to the cells themselves.
  return {
    values: stamps.map((stamp, index) => {
      const millis = msecIndex < 0 ? 0 : Number(rawRows[index][msecIndex] ?? 0);
      return (stamp - stamps[0] + (Number.isFinite(millis) ? millis : 0)) / 1000;
    }),
    base: 'cells',
  };
}

function tidyPeriod(periodMs: number): number {
  const nice = SAMPLE_PERIODS_MS.find((candidate) => Math.abs(candidate - periodMs) <= candidate * 0.02);
  return nice ?? Number(periodMs.toPrecision(3));
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

function detectTrace(context: ParseContext, variant: TraceVariant): number {
  const lines = context.text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(0, 12);
  const matrix = parseCsv(lines.join('\n'));
  const index = headerRowIndex(matrix);
  if (index < 0) return 0;
  const header = matrix[index].map((cell) => cell.trim());
  // Both variants are the same log; the msec column is what tells them apart.
  if (header.some((cell) => MSEC_NAME.test(cell)) !== variant.msec) return 0;

  const body = lines.join('\n');
  let confidence = TIME_NAME.test(header[0]) ? 0.45 : 0.3;
  if (/ログ日時/.test(body)) confidence += 0.2;
  if (/号機番号/.test(body)) confidence += 0.1;
  if (/バージョン/.test(body)) confidence += 0.05;
  const sample = variant.msec
    ? /^\d{1,3}:\d{2}:\d{2},\s*\d{1,3},/m
    : /^\d{1,3}:\d{2}:\d{2}[.,]\d{1,3},/m;
  if (sample.test(body)) confidence += 0.15;
  if (/trc[_-]?\d+/i.test(context.fileName)) confidence += 0.25;
  return Math.min(0.98, confidence);
}

function parseTrace(context: ParseContext, confidence: number, variant: TraceVariant): ParsedDataset {
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
      stats: numericStats(elapsed.values),
    };
    columns.unshift(derived);
    rows = rows.map((row, index) => ({ ...row, [derived.id]: elapsed.values[index] as CellValue }));
    xAxis = derived;
    durationMs = (elapsed.values.at(-1)! - elapsed.values[0]) * 1000;
  }

  const intervals = elapsed && elapsed.values.length > 1 ? elapsed.values.length - 1 : 0;

  return {
    metadata: {
      fileName: context.fileName,
      formatId: variant.id,
      formatName: variant.name,
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
        timeBase: elapsed ? TIME_BASE_LABELS[elapsed.base] : 'なし',
        sampleIntervalMs: intervals
          ? Number((durationMs! / intervals).toFixed(3))
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
  id: TRACE.id,
  name: TRACE.name,
  detect: (context) => detectTrace(context, TRACE),
  parse: (context, confidence = 0.8) => parseTrace(context, confidence, TRACE),
};

export const traceCsv2Format: CsvFormatAdapter = {
  id: TRACE_2.id,
  name: TRACE_2.name,
  detect: (context) => detectTrace(context, TRACE_2),
  parse: (context, confidence = 0.8) => parseTrace(context, confidence, TRACE_2),
};

export const traceInternals = { classifiedNames, tidyPeriod, expandClassification, readHeadline, timeOfDayMs };
