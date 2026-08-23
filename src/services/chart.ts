function niceStep(range: number, targetTicks = 8): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / targetTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const niceFraction = fraction <= 1.5 ? 1 : fraction <= 3 ? 2 : fraction <= 7 ? 5 : 10;
  return niceFraction * power;
}

export function buildNiceTickIndexes(values: unknown[], targetTicks = 8): Set<number> {
  const numeric = values.map(Number);
  if (numeric.length === 0 || numeric.some((value) => !Number.isFinite(value))) return new Set();
  const first = numeric[0];
  const last = numeric.at(-1)!;
  const indexes = new Set([0, numeric.length - 1]);
  const step = niceStep(Math.abs(last - first), targetTicks);
  const low = Math.min(first, last);
  const high = Math.max(first, last);

  for (let tick = Math.ceil(low / step) * step; tick < high; tick += step) {
    let closest = 0;
    for (let index = 1; index < numeric.length; index += 1) {
      if (Math.abs(numeric[index] - tick) < Math.abs(numeric[closest] - tick)) closest = index;
    }
    indexes.add(closest);
  }
  return indexes;
}

export function computeZoomWindow(start: number, end: number, zoomIn: boolean) {
  const center = (start + end) / 2;
  const nextRange = Math.min(100, Math.max(0.5, (end - start) * (zoomIn ? 0.8 : 1.25)));
  let nextStart = center - nextRange / 2;
  let nextEnd = center + nextRange / 2;
  if (nextStart < 0) { nextEnd -= nextStart; nextStart = 0; }
  if (nextEnd > 100) { nextStart -= nextEnd - 100; nextEnd = 100; }
  return { start: Math.max(0, nextStart), end: Math.min(100, nextEnd) };
}

export function wheelZoomAxis(shiftKey: boolean): 'x' | 'y' {
  return shiftKey ? 'y' : 'x';
}

export interface AxisZoomRange {
  id?: string;
  start?: number;
  end?: number;
}

export function yZoomId(index: number): string {
  return `y-wheel-zoom-${index}`;
}

/**
 * Y-axis wheel zoom is dispatched by hand, so the next window has to be derived
 * from the ranges ECharts currently reports rather than from React state. A
 * missing component means the axis is still at its full extent.
 */
export function buildYZoomBatch(zoomOptions: AxisZoomRange[] | undefined, axisCount: number, zoomIn: boolean) {
  return Array.from({ length: Math.max(0, axisCount) }, (_, index) => {
    const dataZoomId = yZoomId(index);
    const zoom = zoomOptions?.find((item) => item.id === dataZoomId);
    return { dataZoomId, ...computeZoomWindow(zoom?.start ?? 0, zoom?.end ?? 100, zoomIn) };
  });
}

export interface TooltipSeriesParam {
  seriesIndex: number;
  seriesName?: string;
  marker?: string;
  axisValueLabel?: string;
  value?: unknown;
  isBoolean?: boolean;
}

const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

export function formatTooltipValue(value: unknown, isBoolean = false): string {
  // Numeric X axes carry [x, y] pairs, category axes carry the bare Y value.
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  // Boolean series are plotted as 0/1, but the table shows false/true, so
  // mirror that here instead of surfacing the raw numeric encoding.
  if (isBoolean || typeof raw === 'boolean') return (raw === 1 || raw === true) ? 'true' : 'false';
  if (raw === null || raw === undefined || raw === '') return '-';
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return String(raw);
  // Same rounding as the X-axis labels: normalizing a series can leave float
  // noise such as 59.99999999999991 that would otherwise reach the tooltip.
  return Number(numeric.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 20 });
}

/**
 * The linked X axes make ECharts group the tooltip one block per grid, which
 * floats the Boolean panels above the analog plot and repeats the X value.
 * Series indexes already follow the visual stack — analog plots first, Boolean
 * panels last — so re-sorting by them puts Boolean rows back at the bottom
 * under a single header.
 */
export function buildTooltipMarkup(params: TooltipSeriesParam[]): string {
  if (params.length === 0) return '';
  const ordered = [...params].sort((left, right) => left.seriesIndex - right.seriesIndex);
  const rows = ordered.map((param) => '<div style="display:flex;align-items:center;gap:6px">'
    + `${param.marker ?? ''}<span style="flex:1">${escapeHtml(param.seriesName ?? '')}</span>`
    + `<b style="font-weight:700;margin-left:24px">${formatTooltipValue(param.value, param.isBoolean)}</b></div>`);
  return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(ordered[0].axisValueLabel ?? '')}</div>${rows.join('')}`;
}
