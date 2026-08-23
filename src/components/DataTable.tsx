import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, ColumnDefinition, DataRow } from '../models/dataset';
import { readDatasetRows } from '../services/datasetStore';
import { chunkStarts, columnWidth, columnWindow, rowWindow } from '../services/virtualRows';

const FALLBACK_ROW_HEIGHT = 38;
const INDEX_WIDTH = 78;
const OVERSCAN = 12;
const CHUNK_ROWS = 120;
const KEEP_CHUNKS = 6;
const COLUMN_OVERSCAN_PX = 600;
// Rows are fetched once the fling settles, so a fast scroll never waits on
// IndexedDB deserializing hundreds of columns per row.
const LOAD_DELAY_MS = 90;

interface CellPlan { id: string; className: string; boolean: boolean; width: number }

interface DataTableProps {
  columns: ColumnDefinition[];
  rowCount: number;
  storeKey?: string;
  xAxisId: string;
  xAxisName: string;
  jumpOptions: Array<{ label: string; rowIndex: number }>;
}

function readMetrics(element: HTMLDivElement) {
  return {
    scrollTop: element.scrollTop,
    viewport: element.clientHeight,
    scrollLeft: element.scrollLeft,
    width: element.clientWidth,
  };
}

function formatCell(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // Synthesized axes carry float noise such as 0.010003334444814938.
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(10))) : '';
  return value;
}

/**
 * Rows are memoized so a window shift only renders the rows that entered it,
 * instead of all 60 rows times every column.
 */
const TableRow = memo(function TableRow({ index, row, plan, firstColumn, lastColumn, highlighted }: {
  index: number;
  row?: DataRow;
  plan: CellPlan[];
  firstColumn: number;
  lastColumn: number;
  highlighted: boolean;
}) {
  return <tr data-row className={highlighted ? 'jump-target' : ''}>
    <td className="row-index">{index + 1}</td>
    {firstColumn > 0 && <td className="column-gap" colSpan={firstColumn} />}
    {plan.slice(firstColumn, lastColumn).map((cell) => {
      const value = row ? row[cell.id] ?? null : null;
      const text = formatCell(value);
      const state = cell.boolean && value !== null ? (value ? 'boolean-true' : 'boolean-false') : '';
      return <td
        className={`${state} ${cell.className}`.trim()}
        key={cell.id}
        title={text.length > 12 ? text : undefined}
      >{text}</td>;
    })}
    {lastColumn < plan.length && <td className="column-gap" colSpan={plan.length - lastColumn} />}
  </tr>;
});

export function DataTable({ columns, rowCount, storeKey, xAxisId, xAxisName, jumpOptions }: DataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requested = useRef(new Set<number>());
  const frame = useRef(0);
  const mounted = useRef(true);

  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT);
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewport: 0, scrollLeft: 0, width: 0 });
  const [chunks, setChunks] = useState(new Map<number, DataRow[]>());
  const [highlightRow, setHighlightRow] = useState<number>();
  const [searchMessage, setSearchMessage] = useState('');

  const plan = useMemo<CellPlan[]>(() => columns.map((column) => ({
    id: column.id,
    boolean: column.type === 'boolean',
    className: column.id === xAxisId
      ? 'x-axis-column'
      : column.stats.changes === 0 ? 'unchanged-column' : '',
    width: columnWidth(column.name),
  })), [columns, xAxisId]);
  // Left edge of every column, so the horizontal window is a lookup, not a measure.
  const offsets = useMemo(() => plan.reduce(
    (edges, cell) => [...edges, edges[edges.length - 1] + cell.width],
    [INDEX_WIDTH],
  ), [plan]);
  const tableWidth = offsets[offsets.length - 1];

  const { first, last } = rowWindow(metrics.scrollTop, metrics.viewport, rowHeight, rowCount, OVERSCAN);
  const { first: firstColumn, last: lastColumn } = columnWindow(
    offsets,
    metrics.scrollLeft,
    metrics.width,
    COLUMN_OVERSCAN_PX,
  );
  const visible = useMemo(
    () => Array.from({ length: Math.max(0, last - first) }, (_, offset) => first + offset),
    [first, last],
  );

  useEffect(() => {
    // Set on every mount: React's development remount would otherwise leave the
    // flag false and every loaded chunk would be dropped.
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  useEffect(() => {
    requested.current = new Set();
    setChunks(new Map());
  }, [storeKey]);

  // The scroll position is sampled once per frame; scrolling itself never waits
  // on React.
  const handleScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const element = scrollRef.current;
      if (element) setMetrics(readMetrics(element));
    });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const read = () => setMetrics(readMetrics(element));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Every row is the same height, so one measurement keeps the spacers honest
  // even after the web font loads or the browser zoom changes.
  useEffect(() => {
    const measure = () => {
      const sample = bodyRef.current?.querySelector('tr[data-row]');
      const measured = sample?.getBoundingClientRect().height ?? 0;
      if (measured > 0 && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
    };
    measure();
    // The web font lands after the first paint and changes the row height.
    void document.fonts?.ready.then(measure).catch(() => undefined);
  }, [plan, rowHeight]);

  useEffect(() => {
    if (!storeKey) return;
    const wanted = chunkStarts(first, last, CHUNK_ROWS, rowCount);
    const missing = wanted.filter((start) => !requested.current.has(start));
    if (missing.length === 0) return;

    const timer = setTimeout(() => {
      missing.forEach((start) => requested.current.add(start));
      void Promise.all(missing.map(async (start) => [
        start,
        (await readDatasetRows(storeKey, start, CHUNK_ROWS)).map((record) => record.row),
      ] as const))
        .then((loaded) => {
          if (!mounted.current) return;
          setChunks((current) => {
            const next = new Map(current);
            loaded.forEach(([start, rows]) => next.set(start, rows));
            // Bound the memory: rows far from the window go back to IndexedDB.
            const keep = KEEP_CHUNKS * CHUNK_ROWS;
            for (const start of [...next.keys()]) {
              if (start < wanted[0] - keep || start > wanted[wanted.length - 1] + keep) {
                next.delete(start);
                requested.current.delete(start);
              }
            }
            return next;
          });
        })
        .catch(() => missing.forEach((start) => requested.current.delete(start)));
    }, LOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [first, last, rowCount, storeKey]);

  const rowAt = (index: number) => {
    const start = Math.floor(index / CHUNK_ROWS) * CHUNK_ROWS;
    return chunks.get(start)?.[index - start];
  };

  const jumpToRow = (rowIndex: number, message: string) => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (rowIndex - 6) * rowHeight);
    setHighlightRow(rowIndex);
    setSearchMessage(message);
  };

  return <div className="virtual-table">
    <div className="table-status">
      <span>{rowCount.toLocaleString()} rows · IndexedDB</span>
      <div className="data-jump">
        <label>{xAxisName}へ移動</label>
        <select defaultValue="" onChange={event => {
          const option = jumpOptions.find(item => item.rowIndex === Number(event.target.value));
          if (option) jumpToRow(option.rowIndex, `${xAxisName}: ${option.label} · Row ${option.rowIndex + 1}`);
        }}>
          <option value="" disabled>目盛りを選択…</option>
          {jumpOptions.map(option => <option value={option.rowIndex} key={option.rowIndex}>{option.label}</option>)}
        </select>
        {searchMessage && <output>{searchMessage}</output>}
      </div>
    </div>
    <div className="table-scroll" ref={scrollRef} onScroll={handleScroll}>
      <table style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: INDEX_WIDTH }} />
          {plan.map((cell) => <col key={cell.id} style={{ width: cell.width }} />)}
        </colgroup>
        <thead><tr>
          <th className="row-index">#</th>
          {firstColumn > 0 && <th className="column-gap" colSpan={firstColumn} />}
          {columns.slice(firstColumn, lastColumn).map((column, index) => <th
            className={plan[firstColumn + index].className}
            key={column.id}
            title={column.name}
          >{column.name}</th>)}
          {lastColumn < plan.length && <th className="column-gap" colSpan={plan.length - lastColumn} />}
        </tr></thead>
        <tbody ref={bodyRef}>
          <tr className="spacer"><td style={{ height: first * rowHeight }} /></tr>
          {visible.map((index) => <TableRow
            key={index}
            index={index}
            row={rowAt(index)}
            plan={plan}
            firstColumn={firstColumn}
            lastColumn={lastColumn}
            highlighted={index === highlightRow}
          />)}
          <tr className="spacer"><td style={{ height: Math.max(0, rowCount - last) * rowHeight }} /></tr>
        </tbody>
      </table>
    </div>
  </div>;
}
