import { useEffect, useRef, useState } from 'react';
import type { ColumnDefinition } from '../models/dataset';
import { findNearestRowByValue, readDatasetRows } from '../services/datasetStore';

const ROW_HEIGHT = 38;
const WINDOW_ROWS = 60;

interface DataTableProps {
  columns: ColumnDefinition[];
  rowCount: number;
  storeKey?: string;
  xAxisId: string;
  xAxisName: string;
  xAxisScale?: number;
  xAxisUnit?: string;
}

export function DataTable({ columns, rowCount, storeKey, xAxisId, xAxisName, xAxisScale = 1, xAxisUnit }: DataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof readDatasetRows>>>([]);
  const [target, setTarget] = useState('');
  const [highlightRow, setHighlightRow] = useState<number>();
  const [searchMessage, setSearchMessage] = useState('');

  useEffect(() => {
    if (!storeKey) return;
    let active = true;
    void readDatasetRows(storeKey, start, WINDOW_ROWS).then((result) => {
      if (active) setRows(result);
    });
    return () => { active = false; };
  }, [start, storeKey]);

  const jumpToRow = (rowIndex: number, message: string) => {
    const nextStart = Math.max(0, Math.min(rowIndex - 8, Math.max(0, rowCount - WINDOW_ROWS)));
    if (scrollRef.current) scrollRef.current.scrollTop = nextStart * ROW_HEIGHT;
    setStart(nextStart);
    setHighlightRow(rowIndex);
    setSearchMessage(message);
  };

  const findTarget = async () => {
    const displayValue = Number.parseFloat(target.replace(/,/g, '.'));
    if (!Number.isFinite(displayValue)) { setSearchMessage('数値を入力してください。'); return; }
    if (xAxisId === '__index') {
      const rowIndex = Math.max(0, Math.min(rowCount - 1, Math.round(displayValue) - 1));
      jumpToRow(rowIndex, `Row ${rowIndex + 1}`);
      return;
    }
    if (!storeKey) { setSearchMessage('データを準備しています…'); return; }
    setSearchMessage('検索中…');
    const record = await findNearestRowByValue(storeKey, rowCount, xAxisId, displayValue / xAxisScale);
    if (!record) { setSearchMessage('このX軸は数値検索できません。'); return; }
    const actual = Number(record.row[xAxisId]) * xAxisScale;
    jumpToRow(record.index, `${xAxisName}: ${Number(actual.toPrecision(10))}${xAxisUnit ? ` ${xAxisUnit}` : ''} · Row ${record.index + 1}`);
  };

  return <div className="virtual-table">
    <div className="table-status">
      <span>{rowCount.toLocaleString()} rows · IndexedDB</span>
      <form className="data-jump" onSubmit={event => { event.preventDefault(); void findTarget(); }}>
        <label>{xAxisName}へ移動</label>
        <input value={target} onChange={event => setTarget(event.target.value)} placeholder={`例: 10.3${xAxisUnit ?? ''}`} inputMode="decimal" />
        <button type="submit">移動</button>
        {searchMessage && <output>{searchMessage}</output>}
      </form>
    </div>
    <div className="table-scroll" ref={scrollRef} onScroll={event => {
      const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT) - 10);
      if (Math.abs(next - start) >= 5) setStart(next);
    }}>
      <table>
        <thead><tr><th>#</th>{columns.map(column => <th key={column.id}>{column.name}</th>)}</tr></thead>
        <tbody>
          <tr className="spacer"><td style={{ height: start * ROW_HEIGHT }} /></tr>
          {rows.map(record => <tr className={record.index === highlightRow ? 'jump-target' : ''} key={record.index}>
            <td>{record.index + 1}</td>
            {columns.map(column => <td key={column.id}>{String(record.row[column.id] ?? '')}</td>)}
          </tr>)}
          <tr className="spacer"><td style={{ height: Math.max(0, rowCount - start - rows.length) * ROW_HEIGHT }} /></tr>
        </tbody>
      </table>
    </div>
  </div>;
}
