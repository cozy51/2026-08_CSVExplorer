import { describe, expect, it } from 'vitest';
import { inferType, parseCsv } from './csv';
import { parseWithFormat } from './formatRegistry';
import { traceInternals } from '../formats/trace';

const yaskawaSample = `[作成日時]
2025/08/12 15:19:46

[サーボパック形式]
SGD7S-2R8A00AY0522A

[モータ形式]
SGM7J-04AFA6C

[トレースデータファイル]
未保存

[トレースデータ]
,TRACE1(#1),TRACE2(#1),I/O1(#1),I/O2(#1)
時間,フィードバック速度(#1),トルク指令(#1),/S-ON(#1),/P-CON(#1)
[ms],[min-1],[%],-,-
0.00000,-0.402832,0.000000,1.000000,1.000000
20.00000,0.000000,-7.823486,0.000000,1.000000
40.00000,52.770996,-9.457214,0.000000,1.000000`;

const traceSample = `,ログ日時,,号機番号,バージョン,
,00/00/00, 00:03:16,0001,IH02-00F-000AA_20200812,
,,,,位置,,,衝突防止センサ(上),,,X00,
時間,msec,アラーム,サブコード,ポイント,走行位置,昇降位置,状態,検出エリア,衝突防止センサ距離(上),パネルアラームリセット,
00:04:09,065,4364,0x01,00000,00000,-00004,0 : --,000,00000,0,
00:04:09,067,4364,0x01,00000,00001,-00004,0 : --,000,00000,1,
00:04:10,070,4364,0x01,00000,00002,-00004,0 : --,000,00000,1,`;

describe('CSV parsing', () => {
  it('handles quoted commas and newlines', () => {
    expect(parseCsv('a,b\n"x,y","z\nq"')).toEqual([['a', 'b'], ['x,y', 'z\nq']]);
  });

  it('infers common types', () => {
    expect(inferType(['1', '2', '3'])).toBe('number');
    expect(inferType(['ON', 'OFF', 'ON'])).toBe('boolean');
    expect(inferType(['0x01', '0x02'])).toBe('code');
  });

  it('falls back to generic CSV', () => {
    expect(parseWithFormat({ fileName: 'plain.csv', text: 'x,y\n1,2' }).metadata.formatId)
      .toBe('generic');
  });

  it('detects the provided Yaskawa export structure', () => {
    const dataset = parseWithFormat({ fileName: 'servo.csv', text: yaskawaSample });
    expect(dataset.metadata.formatId).toBe('yaskawa-servo');
    expect(dataset.metadata.confidence).toBeGreaterThanOrEqual(0.9);
    expect(dataset.metadata.details.servoPackModel).toBe('SGD7S-2R8A00AY0522A');
    expect(dataset.metadata.details.motorModel).toBe('SGM7J-04AFA6C');
    expect(dataset.metadata.durationMs).toBe(40);
    expect(dataset.metadata.xAxisScale).toBe(0.001);
    expect(dataset.metadata.xAxisDisplayUnit).toBe('s');
    expect(dataset.rows).toHaveLength(3);
  });

  it('maps groups, units and I/O columns without leaking format rules to the UI', () => {
    const dataset = parseWithFormat({ fileName: 'servo.csv', text: yaskawaSample });
    const speed = dataset.columns.find((column) => column.name.startsWith('フィードバック速度'))!;
    const servoOn = dataset.columns.find((column) => column.name.startsWith('/S-ON'))!;
    expect(speed.group).toBe('TRACE1(#1)');
    expect(speed.unit).toBe('min-1');
    expect(servoOn.group).toBe('I/O1(#1)');
    expect(servoOn.type).toBe('boolean');
    expect(dataset.rows.map((row) => row[servoOn.id])).toEqual([true, false, false]);
    expect(dataset.metadata.xAxisId).toBe(dataset.columns[0].id);
  });

  it('accepts copied input containing literal newline escapes', () => {
    const escaped = yaskawaSample.replace(/\n/g, '\\n');
    expect(parseWithFormat({ fileName: 'servo.csv', text: escaped }).rows).toHaveLength(3);
  });

  it('detects the trace log structure and keeps its headline metadata', () => {
    const dataset = parseWithFormat({ fileName: 'trc_0001.csv', text: traceSample });
    expect(dataset.metadata.formatId).toBe('trace');
    expect(dataset.metadata.confidence).toBeGreaterThanOrEqual(0.9);
    expect(dataset.metadata.details.logTime).toBe('00/00/00 00:03:16');
    expect(dataset.metadata.details.machineNumber).toBe('0001');
    expect(dataset.metadata.details.version).toBe('IH02-00F-000AA_20200812');
    expect(dataset.metadata.details.headerRow).toBe(4);
    expect(dataset.metadata.details.dataStartRow).toBe(5);
    expect(dataset.rows).toHaveLength(3);
    // The trailing separator must not become a column of its own.
    expect(dataset.columns.filter((column) => column.id !== '__elapsed')).toHaveLength(11);
  });

  it('repeats the omitted classification labels across each block', () => {
    const dataset = parseWithFormat({ fileName: 'trc_0001.csv', text: traceSample });
    const groupOf = (name: string) => dataset.columns.find((column) => column.name === name)?.group;
    expect(groupOf('時間')).toBeUndefined();
    expect(groupOf('位置-ポイント')).toBe('位置');
    expect(groupOf('位置-昇降位置')).toBe('位置');
    expect(groupOf('衝突防止センサ(上)-検出エリア')).toBe('衝突防止センサ(上)');
    const reset = dataset.columns.find((column) => column.name === 'X00-パネルアラームリセット')!;
    expect(reset.group).toBe('X00');
    expect(reset.type).toBe('boolean');
  });

  it('titles every classified column with its block so repeated names stay apart', () => {
    const dataset = parseWithFormat({ fileName: 'trc_0001.csv', text: traceSample });
    const titles = dataset.columns.map((column) => column.name);
    // 時間, msec, アラーム and サブコード have no classification of their own.
    expect(titles.slice(1, 5)).toEqual(['時間', 'msec', 'アラーム', 'サブコード']);
    expect(titles).toContain('位置-走行位置');
    expect(titles).toContain('衝突防止センサ(上)-状態');
    expect(titles).toContain('衝突防止センサ(上)-検出エリア');
    // Numbered fallbacks are only needed when the classified title still repeats.
    expect(titles.filter((title) => /\(\d\)$/.test(title))).toEqual([]);
    expect(traceInternals.classifiedNames(['状態', 'リモートI/O割込み'], ['障害物センサ(下)', 'X19']))
      .toEqual(['障害物センサ(下)-状態', 'X19-リモートI/O割込み']);
  });

  it('carries the final classification block to columns the row stops short of', () => {
    expect(traceInternals.expandClassification(['', '', 'ハンド入力', '', 'ハンド出力'], 7))
      .toEqual(['', '', 'ハンド入力', 'ハンド入力', 'ハンド出力', 'ハンド出力', 'ハンド出力']);
  });

  it('spreads the samples evenly over the seconds the log spans', () => {
    const dataset = parseWithFormat({ fileName: 'trc_0001.csv', text: traceSample });
    expect(dataset.metadata.xAxisId).toBe('__elapsed');
    expect(dataset.metadata.xAxisDisplayUnit).toBe('s');
    expect(dataset.metadata.durationMs).toBe(1000);
    expect(dataset.columns[0].unit).toBe('s');
    // The jittering msec cells are ignored: 3 samples over 1 s land 0.5 s apart.
    expect(dataset.rows.map((row) => row.__elapsed)).toEqual([0, 0.5, 1]);
    expect(dataset.metadata.details.sampleIntervalMs).toBe(500);
  });

  it('reads a 3,000 row recording as 30 seconds at a 10 ms period', () => {
    // Recording starts partway into a second, exactly like a captured log.
    const rows = Array.from({ length: 3000 }, (_, index) => {
      const second = 249 + Math.floor((index + 65) / 100);
      const clock = `00:${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`;
      return `${clock},${String(index % 1000).padStart(3, '0')},${index % 2},`;
    });
    const dataset = parseWithFormat({
      fileName: 'trc_0003.csv',
      text: `時間,msec,値,\n${rows.join('\n')}`,
    });
    const elapsed = dataset.rows.map((row) => Number(row.__elapsed));
    expect(elapsed[0]).toBe(0);
    expect(elapsed.at(-1)).toBe(30);
    expect(dataset.metadata.details.sampleIntervalMs).toBeCloseTo(10, 2);
  });

  it('keeps the elapsed time rising when the log clock passes midnight', () => {
    const dataset = parseWithFormat({
      fileName: 'trc_0002.csv',
      text: '時間,msec,値,\n23:59:59,900,1,\n00:00:00,100,2,',
    });
    expect(dataset.rows.map((row) => row.__elapsed)).toEqual([0, 1]);
  });

  it('keeps support for the original trace timestamp format', () => {
    const dataset = parseWithFormat({
      fileName: 'trc_0001.csv',
      text: 'meta,,,\nGroup,Time,Time\nValue,時間,msec\n1,2026-01-01 00:00:00,123\n2,2026-01-01 00:00:01,123',
    });
    expect(dataset.metadata.formatId).toBe('trace');
    expect(dataset.metadata.xAxisId).toBe('__elapsed');
    expect(dataset.rows.map((row) => row.__elapsed)).toEqual([0, 1]);
  });
});
