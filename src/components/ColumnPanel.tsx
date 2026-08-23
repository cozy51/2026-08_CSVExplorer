import { useMemo, useState } from 'react';
import type { ParsedDataset, SeriesAppearance } from '../models/dataset';

interface ColumnPanelProps {
  dataset: ParsedDataset;
  selected: string[];
  onChange: (value: string[]) => void;
  xAxisId?: string;
  appearances: Record<string, SeriesAppearance>;
  onAppearanceChange: (columnId: string, appearance: SeriesAppearance) => void;
  onPriorityChange: (columnId: string, priority: number) => void;
}

const graphable = (type: string) => ['number', 'boolean'].includes(type);

export function ColumnPanel({
  dataset,
  selected,
  onChange,
  xAxisId,
  appearances,
  onAppearanceChange,
  onPriorityChange,
}: ColumnPanelProps) {
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const columns = useMemo(() => dataset.columns.filter(column => (
    (!query || `${column.group} ${column.name}`.toLowerCase().includes(query.toLowerCase()))
    && (!changing || column.stats.changes > 0)
  )), [dataset, query, changing]);

  return <aside className="columns">
    <div className="panel-heading"><strong>Columns</strong><span>{columns.length}</span></div>
    <input className="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="列を検索…" />
    <label className="filter"><input type="checkbox" checked={changing} onChange={event => setChanging(event.target.checked)} /> 変化した列のみ</label>
    <p className="selection-help">チェック：グラフへ追加／削除<br />上の凡例：系列の名前と色の確認</p>
    <div className="column-list">{columns.map(column => {
      const selectable = graphable(column.type) && column.id !== xAxisId;
      const isSelected = selected.includes(column.id);
      const appearance = appearances[column.id];
      return <div className={'column '+(!selectable ? 'disabled' : '')} key={column.id} title={column.id === xAxisId ? 'X軸として使用中' : column.group}>
        <label className="column-main">
          <input type="checkbox" disabled={!selectable} checked={isSelected} onChange={event => onChange(event.target.checked ? [...selected, column.id] : selected.filter(id => id !== column.id))} />
          <span className="column-name">{column.name}<small>{column.id === xAxisId ? `X axis · ${dataset.metadata.xAxisDisplayUnit ?? column.unit ?? ''}` : column.group}</small></span>
          <span className="type">{column.type}</span>
        </label>
        {isSelected && appearance && <div className="series-style" aria-label={`${column.name}の表示設定`}>
          <label className="priority-control" title="Y軸の優先順位"><span>Y軸</span><select aria-label="Y軸の優先順位" value={selected.indexOf(column.id) + 1} onChange={event => onPriorityChange(column.id, Number(event.target.value))}>
            {selected.map((_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}
          </select></label>
          <label title="線の色"><input type="color" value={appearance.color} onChange={event => onAppearanceChange(column.id, { ...appearance, color: event.target.value })} /></label>
          <select aria-label="線種" value={appearance.lineType} onChange={event => onAppearanceChange(column.id, { ...appearance, lineType: event.target.value as SeriesAppearance['lineType'] })}>
            <option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option>
          </select>
          <select aria-label="線幅" value={appearance.width} onChange={event => onAppearanceChange(column.id, { ...appearance, width: Number(event.target.value) })}>
            <option value="1.5">細</option><option value="2.2">標準</option><option value="3.2">太</option>
          </select>
        </div>}
      </div>;
    })}</div>
  </aside>;
}
