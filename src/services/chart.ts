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
