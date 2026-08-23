/**
 * Geometry for the Data table's virtual scroller. Every row has the same
 * measured height, so the window the viewport shows, the spacers around it and
 * the chunks to read can all be derived without touching the DOM.
 */

export interface RowWindow { first: number; last: number }

export function rowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan: number,
): RowWindow {
  if (!(rowHeight > 0) || rowCount <= 0) return { first: 0, last: 0 };
  const visible = Math.ceil(Math.max(viewportHeight, 0) / rowHeight) + 1;
  const first = Math.min(
    Math.max(0, Math.floor(Math.max(scrollTop, 0) / rowHeight) - overscan),
    Math.max(0, rowCount - 1),
  );
  return { first, last: Math.min(rowCount, first + visible + overscan * 2) };
}

/** Reads cover whole chunks so a few rows of scrolling never hits IndexedDB again. */
export function chunkStarts(first: number, last: number, chunkSize: number, rowCount: number): number[] {
  const end = Math.min(last, rowCount);
  if (end <= first || chunkSize <= 0) return [];
  const starts: number[] = [];
  for (let start = Math.floor(first / chunkSize) * chunkSize; start < end; start += chunkSize) starts.push(start);
  return starts;
}

/**
 * Column widths are fixed up front from the header text, which keeps the table
 * from re-measuring 15,000 cells — and the columns from jittering sideways —
 * every time the row window moves.
 */
export function columnWidth(title: string, minimum = 112, maximum = 320): number {
  let width = 30;
  for (const character of title) width += /[ -ÿ]/.test(character) ? 8 : 14;
  return Math.round(Math.min(maximum, Math.max(minimum, width)));
}

export interface ColumnWindow { first: number; last: number }

/**
 * Only the columns near the horizontal viewport are worth building: a trace log
 * has hundreds of them, and rendering every cell of every row is what makes the
 * table stutter. `offsets` holds each column's left edge plus a final right edge.
 */
export function columnWindow(
  offsets: number[],
  scrollLeft: number,
  viewportWidth: number,
  overscan: number,
): ColumnWindow {
  const count = Math.max(0, offsets.length - 1);
  if (count === 0) return { first: 0, last: 0 };
  const left = Math.max(0, scrollLeft) - overscan;
  const right = Math.max(0, scrollLeft) + Math.max(viewportWidth, 0) + overscan;
  let first = 0;
  while (first < count - 1 && offsets[first + 1] <= left) first += 1;
  let last = first + 1;
  while (last < count && offsets[last] < right) last += 1;
  return { first, last };
}
