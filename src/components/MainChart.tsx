import ReactECharts from 'echarts-for-react';
import type { ColumnDefinition, ParsedDataset } from '../models/dataset';

export type ChartMode = 'individual' | 'normalized' | 'stacked';

interface MainChartProps {
  dataset: ParsedDataset;
  selected: string[];
  xAxis: string;
  mode: ChartMode;
}

const palette = ['#176b87', '#d97738', '#557a46', '#8a5b9d', '#b4443e', '#2874a6'];

function numericValue(value: unknown): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizedValue(value: number | null, column: ColumnDefinition): number | null {
  if (value === null || column.stats.min === undefined || column.stats.max === undefined) return value;
  const range = column.stats.max - column.stats.min;
  return range === 0 ? 0 : ((value - column.stats.min) / range) * 100;
}

export function MainChart({ dataset, selected, xAxis, mode }: MainChartProps) {
  const columns = selected
    .map((id) => dataset.columns.find((column) => column.id === id))
    .filter((column): column is ColumnDefinition => Boolean(column));
  const xValues = dataset.rows.map((row, index) => xAxis === '__index' ? index + 1 : row[xAxis]);
  const stacked = mode === 'stacked';
  const grids = stacked
    ? columns.map((_, index) => ({
        left: 70,
        right: 34,
        top: `${7 + index * (82 / columns.length)}%`,
        height: `${Math.max(10, 72 / columns.length)}%`,
      }))
    : [{ left: 64, right: mode === 'individual' ? 54 : 30, top: 62, bottom: 72 }];

  const option = {
    animation: false,
    color: palette,
    grid: grids,
    legend: { top: 10, left: 18, type: 'scroll', textStyle: { color: '#384650' } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', snap: true },
      backgroundColor: 'rgba(255,255,255,.97)',
      borderColor: '#ccd4d8',
      textStyle: { color: '#22313a' },
    },
    toolbox: {
      right: 18,
      feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: { pixelRatio: 2 } },
    },
    xAxis: (stacked ? columns : [undefined]).map((_, index) => ({
      type: 'category',
      gridIndex: stacked ? index : 0,
      data: xValues,
      boundaryGap: false,
      name: index === (stacked ? columns.length - 1 : 0)
        ? (xAxis === '__index' ? 'Row' : dataset.columns.find((column) => column.id === xAxis)?.name)
        : '',
      axisLine: { lineStyle: { color: '#8b989e' } },
      axisLabel: { color: '#66747b', show: !stacked || index === columns.length - 1, hideOverlap: true },
      axisPointer: { show: true, snap: true },
    })),
    yAxis: columns.map((column, index) => ({
      type: 'value',
      gridIndex: stacked ? index : 0,
      name: stacked ? `${column.name}${column.unit ? ` [${column.unit}]` : ''}` : undefined,
      nameLocation: 'middle',
      nameGap: stacked ? 48 : 36,
      scale: column.type !== 'boolean',
      min: column.type === 'boolean' ? -0.1 : undefined,
      max: column.type === 'boolean' ? 1.1 : undefined,
      position: !stacked && index % 2 ? 'right' : 'left',
      offset: !stacked && index > 1 ? Math.floor(index / 2) * 44 : 0,
      axisLine: { show: true, lineStyle: { color: palette[index % palette.length] } },
      axisLabel: { color: palette[index % palette.length] },
      splitLine: { lineStyle: { color: '#e8ecee' } },
    })),
    dataZoom: [
      { type: 'inside', xAxisIndex: stacked ? columns.map((_, index) => index) : [0], filterMode: 'none' },
      { type: 'slider', xAxisIndex: stacked ? columns.map((_, index) => index) : [0], height: 22, bottom: 14 },
    ],
    series: columns.map((column, index) => ({
      name: column.name,
      type: 'line',
      xAxisIndex: stacked ? index : 0,
      yAxisIndex: index,
      data: dataset.rows.map((row) => {
        const value = numericValue(row[column.id]);
        return mode === 'normalized' ? normalizedValue(value, column) : value;
      }),
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.5 },
      step: column.type === 'boolean' ? 'end' : false,
      connectNulls: false,
      large: true,
    })),
  };

  return <div className="chart"><ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} /></div>;
}
