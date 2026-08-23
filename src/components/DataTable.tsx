import { useEffect, useRef, useState } from 'react';
import type { ColumnDefinition } from '../models/dataset';
import { readDatasetRows } from '../services/datasetStore';

const ROW_HEIGHT = 38;
const WINDOW_ROWS = 60;

interface DataTableProps {
  columns: ColumnDefinition[];
  rowCount: number;
  storeKey?: string;
  xAxisId: string;
  xAxisName: string;
  jumpOptions: Array<{ label: string; rowIndex: number }>;
}

export function DataTable({ columns, rowCount, storeKey, xAxisId, xAxisName, jumpOptions }: DataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof readDatasetRows>>>([]);
  const [highlightRow, setHighlightRow] = useState<number>();
  const [searchMessage, setSearchMessage] = useState('');
  const lastScrolledRow = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!storeKey) return;
    let active = true;
    void readDatasetRows(storeKey, start, WINDOW_ROWS).then((result) => {
      if (active) setRows(result);
    });
    return () => { active = false; };
  }, [start, storeKey]);

  useEffect(() => {
    if (highlightRow === undefined || lastScrolledRow.current === highlightRow) return;
    if (!rows.some(record => record.index === highlightRow) || !scrollRef.current) return;
    lastScrolledRow.current = highlightRow;
    scrollRef.current.scrollTop = Math.max(0, highlightRow - 6) * ROW_HEIGHT;
  }, [highlightRow, rows]);

  const jumpToRow = (rowIndex: number, message: string) => {
    const nextStart = Math.max(0, Math.min(rowIndex - 8, Math.max(0, rowCount - WINDOW_ROWS)));
    lastScrolledRow.current = undefined;
    setStart(nextStart);
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
    <div className="table-scroll" ref={scrollRef} onScroll={event => {
      const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT) - 10);
      if (Math.abs(next - start) >= 5) setStart(next);
    }}>
      <table>
        <thead><tr><th>#</th>{columns.map(column => {
          const roleClass = column.id === xAxisId ? 'x-axis-column' : column.stats.changes === 0 ? 'unchanged-column' : '';
          return <th className={roleClass} key={column.id}>{column.name}</th>;
        })}</tr></thead>
        <tbody>
          <tr className="spacer"><td style={{ height: start * ROW_HEIGHT }} /></tr>
          {rows.map(record => <tr className={record.index === highlightRow ? 'jump-target' : ''} key={record.index}>
            <td>{record.index + 1}</td>
            {columns.map(column => {
              const value = record.row[column.id];
              const booleanClass = column.type === 'boolean' && value !== null
                ? (value === true ? 'boolean-true' : 'boolean-false')
                : '';
              const roleClass = column.id === xAxisId ? 'x-axis-column' : column.stats.changes === 0 ? 'unchanged-column' : '';
              return <td className={`${booleanClass} ${roleClass}`.trim()} key={column.id}>{String(value ?? '')}</td>;
            })}
          </tr>)}
          <tr className="spacer"><td style={{ height: Math.max(0, rowCount - start - rows.length) * ROW_HEIGHT }} /></tr>
        </tbody>
      </table>
    </div>
  </div>;
}
