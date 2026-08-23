export type ColumnType = 'number' | 'boolean' | 'category' | 'text' | 'datetime' | 'code';
export type CellValue = string | number | boolean | null;
export interface ColumnStats { changes: number; missing: number; unique: number; min?: number; max?: number; average?: number }
export interface ColumnDefinition { id: string; name: string; group?: string; unit?: string; type: ColumnType; stats: ColumnStats }
export type DataRow = Record<string, CellValue>;
export interface DatasetMetadata { fileName: string; formatId: string; formatName: string; confidence: number; delimiter: string; details: Record<string, string | number>; xAxisId?: string; xAxisScale?: number; xAxisDisplayUnit?: string; durationMs?: number }
export interface ParsedDataset { metadata: DatasetMetadata; columns: ColumnDefinition[]; rows: DataRow[] }
export interface ParseContext { fileName: string; text: string }
export interface CsvFormatAdapter { id: string; name: string; detect(context: ParseContext): number; parse(context: ParseContext, confidence?: number): ParsedDataset }
export interface SeriesAppearance { color: string; lineType: 'solid' | 'dashed' | 'dotted'; width: number }
