import { describe, expect, it } from 'vitest';
import { decodeCsvBuffer, encodingInternals } from './encoding';

describe('CSV encoding detection', () => {
  it('keeps a UTF-8 CSV intact', () => {
    const bytes = new TextEncoder().encode('[トレースデータ]\n時間,速度\n0,1');
    const decoded = decodeCsvBuffer(bytes.buffer);
    expect(decoded.encoding).toBe('UTF-8');
    expect(decoded.text).toContain('[トレースデータ]');
  });

  it('decodes a Shift_JIS Yaskawa section header', () => {
    // "[トレースデータ]\r\n時間,速度\r\n0,1" encoded as Windows-31J.
    const bytes = Uint8Array.from([
      0x5b, 0x83, 0x67, 0x83, 0x8c, 0x81, 0x5b, 0x83, 0x58, 0x83, 0x66, 0x81, 0x5b,
      0x83, 0x5e, 0x5d, 0x0d, 0x0a, 0x8e, 0x9e, 0x8a, 0xd4, 0x2c, 0x91, 0xac, 0x93,
      0x78, 0x0d, 0x0a, 0x30, 0x2c, 0x31,
    ]);
    const decoded = decodeCsvBuffer(bytes.buffer);
    expect(decoded.encoding).toBe('Shift_JIS');
    expect(decoded.text).toContain('[トレースデータ]');
    expect(decoded.text).toContain('時間,速度');
  });

  it('strongly penalizes replacement-character mojibake', () => {
    expect(encodingInternals.decodingPenalty('���')).toBeGreaterThan(
      encodingInternals.decodingPenalty('時間'),
    );
  });
});
