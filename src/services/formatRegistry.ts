import type { CsvFormatAdapter, ParseContext } from '../models/dataset';
import { genericCsvFormat } from '../formats/generic'; import { traceCsvFormat } from '../formats/trace';
export const formats:CsvFormatAdapter[]=[traceCsvFormat,genericCsvFormat];
export function parseWithFormat(context:ParseContext,selected='auto'){if(selected!=='auto'){const a=formats.find(f=>f.id===selected);if(!a)throw new Error('形式が見つかりません。');return a.parse(context,a.detect(context));}const ranked=formats.map(adapter=>({adapter,confidence:adapter.detect(context)})).sort((a,b)=>b.confidence-a.confidence);const best=ranked[0].confidence>=.35?ranked[0]:{adapter:genericCsvFormat,confidence:.1};return best.adapter.parse(context,best.confidence);}
