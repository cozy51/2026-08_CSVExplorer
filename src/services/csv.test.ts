import { describe, expect, it } from 'vitest';
import { inferType, parseCsv } from './csv';
import { parseWithFormat } from './formatRegistry';

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

  it('keeps support for the original trace timestamp format', () => {
    const dataset = parseWithFormat({
      fileName: 'trc_0001.csv',
      text: 'meta,,,\nGroup,Time,Time\nValue,時間,msec\n1,2026-01-01 00:00:00,123',
    });
    expect(dataset.metadata.formatId).toBe('trace');
    expect(dataset.metadata.xAxisId).toBe('__timestamp');
  });
});
