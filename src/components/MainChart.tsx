import ReactECharts from 'echarts-for-react';
import { useEffect, useRef } from 'react';
import type { ColumnDefinition, ParsedDataset, SeriesAppearance } from '../models/dataset';
import { buildNiceTickIndexes, computeZoomWindow, wheelZoomAxis } from '../services/chart';

export type ChartMode = 'individual' | 'normalized' | 'stacked';

interface MainChartProps {
  dataset: ParsedDataset;
  selected: string[];
  xAxis: string;
  mode: ChartMode;
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

export function MainChart({ dataset, selected, xAxis, mode, appearances }: MainChartProps) {
  const chartRef = useRef<ReactECharts>(null);
  const selectedColumns = selected
    .map((id) => dataset.columns.find((column) => column.id === id))
    .filter((column): column is ColumnDefinition => Boolean(column));
  const analogColumns = selectedColumns.filter((column) => column.type !== 'boolean');
  const booleanColumns = selectedColumns.filter((column) => column.type === 'boolean');
  // The visual stack is the canonical order: analog plots first, Boolean
  // panels last. ECharts uses this same order for legend and tooltip entries.
  const columns = [...analogColumns, ...booleanColumns];
  const yAxisCount = columns.length;
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

  useEffect(() => {
    const instance = chartRef.current?.getEchartsInstance();
    const chartElement = instance?.getDom();
    if (!instance || !chartElement) return;
    const handleShiftWheel = (event: WheelEvent) => {
      // Normal wheel events continue to ECharts' built-in X dataZoom. Capture
      // Shift+wheel first so it cannot also reach that X-axis handler.
      if (wheelZoomAxis(event.shiftKey) === 'x') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const zoomOptions = instance.getOption().dataZoom as Array<{ id?: string; start?: number; end?: number }> | undefined;
      for (let index = 0; index < yAxisCount; index += 1) {
        const dataZoomId = `y-wheel-zoom-${index}`;
        const zoom = zoomOptions?.find(item => item.id === dataZoomId);
        const next = computeZoomWindow(zoom?.start ?? 0, zoom?.end ?? 100, event.deltaY < 0);
        instance.dispatchAction({ type: 'dataZoom', dataZoomId, ...next });
      }
    };
    chartElement.addEventListener('wheel', handleShiftWheel, { capture: true, passive: false });
    return () => chartElement.removeEventListener('wheel', handleShiftWheel, { capture: true });
  }, [yAxisCount]);

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
      order: 'seriesAsc',
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
      { id: 'x-wheel-zoom', type: 'inside', xAxisIndex: grids.map((_, index) => index), filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseWheel: false },
      { type: 'slider', xAxisIndex: grids.map((_, index) => index), height: 22, bottom: 14 },
      ...columns.map((_, index) => ({
        id: `y-wheel-zoom-${index}`,
        type: 'inside',
        yAxisIndex: index,
        filterMode: 'none',
        zoomOnMouseWheel: false,
        moveOnMouseWheel: false,
        moveOnMouseMove: false,
      })),
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

  return <div className="chart chart-context">
    <ReactECharts ref={chartRef} option={option} notMerge style={{ height: '100%', width: '100%' }} />
    <span className="zoom-help">ホイール: X軸ズーム · Shift＋ホイール: Y軸ズーム</span>
  </div>;
}
