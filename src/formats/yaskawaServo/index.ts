import type {
  CellValue,
  ColumnDefinition,
  CsvFormatAdapter,
  DataRow,
  ParseContext,
  ParsedDataset,
} from '../../models/dataset';
import { defineColumns, detectDelimiter, parseCsv } from '../../services/csv';

const TRACE_SECTION = '[トレースデータ]';

function normalizedLines(text: string): string[] {
  // Some export/copy paths contain the two characters "\\n" instead of LF.
  const normalized = text.includes('\\n') && !text.includes('\n')
    ? text.replace(/\\n/g, '\n')
    : text;
  return normalized.replace(/^\uFEFF/, '').split(/\r?\n/);
}

function sectionValue(lines: string[], section: string): string | undefined {
  const index = lines.findIndex((line) => line.trim() === `[${section}]`);
  return index >= 0 ? lines.slice(index + 1).find((line) => line.trim())?.trim() : undefined;
}

function isNumericRow(row: string[], width: number): boolean {
  if (row.length !== width || row.length === 0) return false;
  return row.every((value) => value.trim() === '' || Number.isFinite(Number(value)));
}

function detectYaskawaServo(context: ParseContext): number {
  const head = normalizedLines(context.text).slice(0, 40).join('\n');
  let confidence = 0;
  if (head.includes(TRACE_SECTION)) confidence += 0.35;
  if (/\[サーボパック形式\]|\[モータ形式\]/.test(head)) confidence += 0.25;
  if (/TRACE\d+\(#\d+\)/.test(head)) confidence += 0.2;
  if (/^時間,.*\n\[ms\],/m.test(head)) confidence += 0.15;
  if (/SGD\w+|SGM\w+/.test(head)) confidence += 0.05;
  return Math.min(confidence, 1);
}

function parseYaskawaServo(context: ParseContext, confidence = 0.9): ParsedDataset {
  const lines = normalizedLines(context.text);
  const sectionIndex = lines.findIndex((line) => line.trim() === TRACE_SECTION);
  if (sectionIndex < 0) throw new Error('「[トレースデータ]」セクションが見つかりません。');

  const traceText = lines.slice(sectionIndex + 1).join('\n');
  const delimiter = detectDelimiter(traceText);
  const matrix = parseCsv(traceText, delimiter);
  if (matrix.length < 4) throw new Error('トレースデータのヘッダまたはデータが不足しています。');

  const groupRow = matrix[0];
  const nameRow = matrix[1];
  const unitRow = matrix[2];
  const rawRows = matrix.slice(3).filter((row) => isNumericRow(row, nameRow.length));
  if (rawRows.length === 0) throw new Error('数値のトレースデータが見つかりません。');

  const columns = defineColumns(nameRow, rawRows, groupRow).map((column, index) => {
    const unit = unitRow[index]?.trim().replace(/^\[(.*)\]$/, '$1');
    const values = rawRows.map((row) => Number(row[index]));
    const isDigital = /^I\/O/i.test(groupRow[index]?.trim() ?? '')
      && values.every((value) => value === 0 || value === 1);
    return {
      ...column,
      unit: unit && unit !== '-' ? unit : undefined,
      type: isDigital ? 'boolean' as const : column.type,
    };
  });

  const rows: DataRow[] = rawRows.map((rawRow) => Object.fromEntries(
    columns.map((column, index) => {
      const numeric = Number(rawRow[index]);
      const value: CellValue = column.type === 'boolean' ? numeric !== 0 : numeric;
      return [column.id, value];
    }),
  ));

  const timeColumn = columns.find((column) => column.name === '時間') ?? columns[0];
  const timeValues = rows.map((row) => Number(row[timeColumn.id]));
  const durationMs = timeColumn.unit === 'ms' && timeValues.length > 1
    ? timeValues.at(-1)! - timeValues[0]
    : undefined;

  return {
    metadata: {
      fileName: context.fileName,
      formatId: 'yaskawa-servo',
      formatName: 'Yaskawa Servo Trace',
      confidence,
      delimiter,
      xAxisId: timeColumn.id,
      xAxisScale: timeColumn.unit === 'ms' ? 0.001 : 1,
      xAxisDisplayUnit: timeColumn.unit === 'ms' ? 's' : timeColumn.unit,
      durationMs,
      details: {
        createdAt: sectionValue(lines, '作成日時') ?? '不明',
        servoPackModel: sectionValue(lines, 'サーボパック形式') ?? '不明',
        motorModel: sectionValue(lines, 'モータ形式') ?? '不明',
        traceDataFile: sectionValue(lines, 'トレースデータファイル') ?? '不明',
        groupRow: sectionIndex + 2,
        headerRow: sectionIndex + 3,
        unitRow: sectionIndex + 4,
        dataStartRow: sectionIndex + 5,
      },
    },
    columns,
    rows,
  };
}

export const yaskawaServoFormat: CsvFormatAdapter = {
  id: 'yaskawa-servo',
  name: 'Yaskawa Servo Trace',
  detect: detectYaskawaServo,
  parse: parseYaskawaServo,
};

export const yaskawaServoInternals = { normalizedLines, sectionValue };
