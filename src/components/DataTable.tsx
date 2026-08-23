import { useEffect, useRef, useState } from 'react';
import type { ColumnDefinition } from '../models/dataset';
import { readDatasetRows } from '../services/datasetStore';

const ROW_HEIGHT = 38;
const WINDOW_ROWS = 60;

interface DataTableProps {
  columns: ColumnDefinition[];
  rowCount: number;
  storeKey?: string;
  jumpRow?: number;
}

export function DataTable({ columns, rowCount, storeKey, jumpRow }: DataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof readDatasetRows>>>([]);

  useEffect(() => {
    if (!storeKey) return;
    let active = true;
    void readDatasetRows(storeKey, start, WINDOW_ROWS).then((result) => {
      if (active) setRows(result);
    });
    return () => { active = false; };
  }, [start, storeKey]);

  useEffect(() => {
    if (jumpRow === undefined || !scrollRef.current) return;
    const nextStart = Math.max(0, Math.min(jumpRow - 8, rowCount - WINDOW_ROWS));
    scrollRef.current.scrollTop = nextStart * ROW_HEIGHT;
    setStart(nextStart);
  }, [jumpRow, rowCount]);

  return <div className="virtual-table">
    <div className="table-status">
      <span>{rowCount.toLocaleString()} rows · IndexedDB</span>
      {jumpRow !== undefined && <strong>Row {jumpRow + 1}</strong>}
    </div>
    <div className="table-scroll" ref={scrollRef} onScroll={event => {
      const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT) - 10);
      if (Math.abs(next - start) >= 5) setStart(next);
    }}>
      <table>
        <thead><tr><th>#</th>{columns.map(column => <th key={column.id}>{column.name}</th>)}</tr></thead>
        <tbody>
          <tr className="spacer"><td style={{ height: start * ROW_HEIGHT }} /></tr>
          {rows.map(record => <tr className={record.index === jumpRow ? 'jump-target' : ''} key={record.index}>
            <td>{record.index + 1}</td>
            {columns.map(column => <td key={column.id}>{String(record.row[column.id] ?? '')}</td>)}
          </tr>)}
          <tr className="spacer"><td style={{ height: Math.max(0, rowCount - start - rows.length) * ROW_HEIGHT }} /></tr>
        </tbody>
      </table>
    </div>
  </div>;
}
