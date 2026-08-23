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
  const xScale = xAxis === dataset.metadata.xAxisId ? (dataset.metadata.xAxisScale ?? 1) : 1;
  const xValues = dataset.rows.map((row, index) => {
    if (xAxis === '__index') return index + 1;
    const value = row[xAxis];
    return typeof value === 'number' ? value * xScale : value;
  });
  const selectedXAxis = dataset.columns.find((column) => column.id === xAxis);
  const xAxisName = xAxis === '__index'
    ? 'Row'
    : `${selectedXAxis?.name ?? ''}${dataset.metadata.xAxisDisplayUnit ? ` [${dataset.metadata.xAxisDisplayUnit}]` : ''}`;
  const stacked = mode === 'stacked';
  const grids = stacked
    ? columns.map((_, index) => ({
        left: 70,
        right: 34,
        top: `${7 + index * (82 / columns.length)}%`,
        height: `${Math.max(10, 72 / columns.length)}%`,
      }))
    : [{ left: 70, right: mode === 'individual' ? 72 + Math.max(0, columns.length - 2) * 58 : 34, top: 62, bottom: 96 }];

  const option = {
    animation: false,
    color: palette,
    grid: grids,
    textStyle: { fontFamily: 'Inter, Noto Sans JP, sans-serif', fontSize: 14, color: '#263941' },
    legend: {
      top: 10,
      left: 24,
      type: 'scroll',
      itemWidth: 24,
      itemHeight: 12,
      itemGap: 22,
      textStyle: { color: '#263941', fontSize: 14 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', snap: true },
      backgroundColor: 'rgba(255,255,255,.97)',
      borderColor: '#ccd4d8',
      textStyle: { color: '#22313a', fontSize: 14, lineHeight: 22 },
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
        ? xAxisName
        : '',
      nameLocation: 'middle',
      nameGap: 42,
      nameTextStyle: { fontSize: 14, fontWeight: 600 },
      axisLine: { lineStyle: { color: '#687b83', width: 1.5 } },
      axisTick: { lineStyle: { width: 1.5 }, length: 6 },
      axisLabel: { color: '#455b64', fontSize: 13, margin: 10, show: !stacked || index === columns.length - 1, hideOverlap: true },
      axisPointer: { show: true, snap: true },
    })),
    yAxis: columns.map((column, index) => ({
      type: 'value',
      gridIndex: stacked ? index : 0,
      name: stacked ? `${column.name}${column.unit ? ` [${column.unit}]` : ''}` : undefined,
      nameLocation: 'middle',
      nameGap: stacked ? 52 : 40,
      nameTextStyle: { fontSize: 13, fontWeight: 600 },
      scale: column.type !== 'boolean',
      min: column.type === 'boolean' ? -0.1 : undefined,
      max: column.type === 'boolean' ? 1.1 : undefined,
      position: !stacked && index > 0 ? 'right' : 'left',
      offset: !stacked && index > 1 ? (index - 1) * 58 : 0,
      axisLine: { show: true, lineStyle: { color: palette[index % palette.length], width: 1.6 } },
      axisTick: { show: true, lineStyle: { color: palette[index % palette.length], width: 1.4 } },
      axisLabel: { color: palette[index % palette.length], fontSize: 13, fontWeight: 500, margin: 10 },
      splitLine: { lineStyle: { color: '#dce3e5', width: 1.2 } },
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
      lineStyle: { width: 2.2 },
      step: column.type === 'boolean' ? 'end' : false,
      connectNulls: false,
      large: true,
    })),
  };

  return <div className="chart"><ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} /></div>;
}
