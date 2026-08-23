import { genericCsvFormat } from '../formats/generic';
import { traceCsv2Format, traceCsvFormat } from '../formats/trace';
import { yaskawaServoFormat } from '../formats/yaskawaServo';
import type { CsvFormatAdapter, ParseContext } from '../models/dataset';

export const formats: CsvFormatAdapter[] = [
  yaskawaServoFormat,
  traceCsvFormat,
  traceCsv2Format,
  genericCsvFormat,
];

export function parseWithFormat(context: ParseContext, selected = 'auto') {
  if (selected !== 'auto') {
    const adapter = formats.find((format) => format.id === selected);
    if (!adapter) throw new Error('形式が見つかりません。');
    return adapter.parse(context, adapter.detect(context));
  }

  const ranked = formats
    .map((adapter) => ({ adapter, confidence: adapter.detect(context) }))
    .sort((left, right) => right.confidence - left.confidence);
  const best = ranked[0].confidence >= 0.35
    ? ranked[0]
    : { adapter: genericCsvFormat, confidence: 0.1 };
  return best.adapter.parse(context, best.confidence);
}
