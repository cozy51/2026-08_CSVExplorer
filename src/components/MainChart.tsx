import ReactECharts from 'echarts-for-react';
import { useRef, useState } from 'react';
import type { ColumnDefinition, ParsedDataset, SeriesAppearance } from '../models/dataset';
import { buildNiceTickIndexes } from '../services/chart';

export type ChartMode = 'individual' | 'normalized' | 'stacked';

interface MainChartProps {
  dataset: ParsedDataset;
  selected: string[];
  xAxis: string;
  mode: ChartMode;
  onJumpToRow?: (rowIndex: number) => void;
  appearances: Record<string, SeriesAppearance>;
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

export function MainChart({ dataset, selected, xAxis, mode, onJumpToRow, appearances }: MainChartProps) {
  const chartRef = useRef<{ getEchartsInstance(): { convertFromPixel(finder: object, value: number[]): unknown } }>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number; rowIndex: number }>();
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
  const analogColumns = columns.filter((column) => column.type !== 'boolean');
  const booleanColumns = columns.filter((column) => column.type === 'boolean');
  const hybrid = !stacked && analogColumns.length > 0 && booleanColumns.length > 0;
  const panelColumns = stacked || analogColumns.length === 0 ? columns : booleanColumns;
  const mainHeight = Math.max(40, 66 - booleanColumns.length * 9);
  // Every synchronized panel must use the exact same horizontal plot area.
  // Otherwise the same category index maps to a different pixel in the flag
  // panels whenever the main panel reserves room for multiple Y axes.
  const sharedRight = mode === 'individual'
    ? 72 + Math.max(0, analogColumns.length - 2) * 58
    : 34;
  const grids = stacked || analogColumns.length === 0
    ? panelColumns.map((_, index) => ({
        left: 70,
        right: 34,
        top: `${7 + index * (82 / panelColumns.length)}%`,
        height: `${Math.max(9, 70 / panelColumns.length)}%`,
      }))
    : hybrid
      ? [
          { left: 70, right: sharedRight, top: 62, height: `${mainHeight}%` },
          ...booleanColumns.map((_, index) => ({
            left: 70,
            right: sharedRight,
            top: `${14 + mainHeight + index * 10}%`,
            height: '7%',
          })),
        ]
      : [{ left: 70, right: sharedRight, top: 62, bottom: 96 }];
  const gridIndexFor = (column: ColumnDefinition, columnIndex: number) => {
    if (stacked || analogColumns.length === 0) return columnIndex;
    if (hybrid && column.type === 'boolean') return booleanColumns.indexOf(column) + 1;
    return 0;
  };
  const numericXAxis = xValues.length > 0 && xValues.every((value) => typeof value === 'number' && Number.isFinite(value));
  const niceTickIndexes = buildNiceTickIndexes(xValues, 20);
  const numericXValues = numericXAxis ? xValues as number[] : [];
  const numericXMin = numericXAxis ? numericXValues.reduce((minimum, value) => Math.min(minimum, value), Infinity) : undefined;
  const numericXMax = numericXAxis ? numericXValues.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : undefined;

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
      selectedMode: false,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', snap: true },
      backgroundColor: 'rgba(255,255,255,.97)',
      borderColor: '#ccd4d8',
      textStyle: { color: '#22313a', fontSize: 14, lineHeight: 22 },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    toolbox: {
      right: 18,
      feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: { pixelRatio: 2 } },
    },
    xAxis: grids.map((_, index) => ({
      type: numericXAxis ? 'value' : 'category',
      gridIndex: index,
      data: numericXAxis ? undefined : xValues,
      min: numericXMin,
      max: numericXMax,
      splitNumber: numericXAxis ? 20 : undefined,
      boundaryGap: numericXAxis ? [0, 0] : false,
      name: index === grids.length - 1
        ? xAxisName
        : '',
      nameLocation: 'middle',
      nameGap: 42,
      nameTextStyle: { fontSize: 14, fontWeight: 600 },
      axisLine: { lineStyle: { color: '#687b83', width: 1.5 } },
      axisTick: { lineStyle: { width: 1.5 }, length: 6 },
      axisLabel: {
        color: '#455b64',
        fontSize: 13,
        margin: 10,
        show: index === grids.length - 1,
        interval: numericXAxis ? undefined : (tickIndex: number) => niceTickIndexes.has(tickIndex),
        showMinLabel: true,
        showMaxLabel: true,
        formatter: (value: string) => {
          const numeric = Number(value);
          return Number.isFinite(numeric) ? Number(numeric.toPrecision(10)).toLocaleString() : value;
        },
        hideOverlap: true,
      },
      axisPointer: { show: true, snap: true },
    })),
    yAxis: columns.map((column, index) => ({
      type: 'value',
      gridIndex: gridIndexFor(column, index),
      name: (stacked || column.type === 'boolean') ? `${column.name}${column.unit ? ` [${column.unit}]` : ''}` : undefined,
      nameLocation: 'middle',
      nameGap: stacked ? 52 : 40,
      nameTextStyle: { fontSize: 13, fontWeight: 600 },
      scale: column.type !== 'boolean',
      min: column.type === 'boolean' ? -0.1 : undefined,
      max: column.type === 'boolean' ? 1.1 : undefined,
      position: !stacked && column.type !== 'boolean' && analogColumns.indexOf(column) > 0 ? 'right' : 'left',
      offset: !stacked && column.type !== 'boolean' && analogColumns.indexOf(column) > 1 ? (analogColumns.indexOf(column) - 1) * 58 : 0,
      axisLine: { show: true, lineStyle: { color: appearances[column.id]?.color ?? palette[index % palette.length], width: 1.6 } },
      axisTick: { show: true, lineStyle: { color: appearances[column.id]?.color ?? palette[index % palette.length], width: 1.4 } },
      axisLabel: { color: appearances[column.id]?.color ?? palette[index % palette.length], fontSize: 13, fontWeight: 500, margin: 10 },
      splitLine: { lineStyle: { color: '#dce3e5', width: 1.2 } },
    })),
    dataZoom: [
      { type: 'inside', xAxisIndex: grids.map((_, index) => index), filterMode: 'none' },
      { type: 'slider', xAxisIndex: grids.map((_, index) => index), height: 22, bottom: 14 },
    ],
    series: columns.map((column, index) => ({
      name: column.name,
      type: 'line',
      xAxisIndex: gridIndexFor(column, index),
      yAxisIndex: index,
      data: dataset.rows.map((row, rowIndex) => {
        const value = numericValue(row[column.id]);
        const displayedValue = mode === 'normalized' ? normalizedValue(value, column) : value;
        return numericXAxis ? [numericXValues[rowIndex], displayedValue] : displayedValue;
      }),
      showSymbol: false,
      sampling: 'lttb',
      itemStyle: { color: appearances[column.id]?.color ?? palette[index % palette.length] },
      lineStyle: {
        color: appearances[column.id]?.color ?? palette[index % palette.length],
        width: appearances[column.id]?.width ?? 2.2,
        type: appearances[column.id]?.lineType ?? 'solid',
      },
      step: column.type === 'boolean' ? 'end' : false,
      connectNulls: false,
      large: true,
    })),
  };

  return <div className="chart chart-context" onClick={() => setContextMenu(undefined)} onContextMenu={event => {
    event.preventDefault();
    const instance = chartRef.current?.getEchartsInstance();
    const converted = instance?.convertFromPixel(
      { xAxisIndex: 0 },
      [event.nativeEvent.offsetX, event.nativeEvent.offsetY],
    );
    const rawXValue = Array.isArray(converted) ? converted[0] : converted;
    let rowIndex: number;
    if (numericXAxis) {
      const xValue = Number(rawXValue);
      if (!Number.isFinite(xValue)) return;
      rowIndex = 0;
      for (let index = 1; index < xValues.length; index += 1) {
        if (Math.abs(Number(xValues[index]) - xValue) < Math.abs(Number(xValues[rowIndex]) - xValue)) {
          rowIndex = index;
        }
      }
    } else {
      rowIndex = xValues.findIndex(value => String(value) === String(rawXValue));
      if (rowIndex < 0 && typeof rawXValue === 'number') rowIndex = Math.round(rawXValue);
      if (rowIndex < 0 || rowIndex >= xValues.length) return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({ left: event.clientX - bounds.left, top: event.clientY - bounds.top, rowIndex });
  }}>
    <ReactECharts ref={chartRef} option={option} notMerge style={{ height: '100%', width: '100%' }} />
    {contextMenu && <div className="chart-menu" style={{ left: contextMenu.left, top: contextMenu.top }} onClick={event => event.stopPropagation()}>
      <small>Row {contextMenu.rowIndex + 1}</small>
      <button onClick={() => onJumpToRow?.(contextMenu.rowIndex)}>Dataでこの行を表示</button>
    </div>}
  </div>;
}
