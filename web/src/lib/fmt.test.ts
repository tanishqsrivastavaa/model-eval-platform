import { describe, expect, it } from 'vitest';
import { ago, fmtCost, fmtMs, fmtNum, pretty } from './fmt';

describe('fmtMs thresholds', () => {
  it('23. fmtMs matches app.js thresholds', () => {
    expect(fmtMs(null)).toBe('—');
    expect(fmtMs(undefined)).toBe('—');
    expect(fmtMs(Number.NaN)).toBe('—');
    expect(fmtMs(0)).toBe('0ms');
    expect(fmtMs(499.4)).toBe('499ms');
    expect(fmtMs(999)).toBe('999ms');
    expect(fmtMs(1000)).toBe('1.00s');
    expect(fmtMs(1500)).toBe('1.50s');
    expect(fmtMs(9999)).toBe('10.00s'); // <10000 keeps 2 decimals
    expect(fmtMs(10000)).toBe('10.0s');
    expect(fmtMs(59_999)).toBe('60.0s');
    expect(fmtMs(60_000)).toBe('1m0s');
    expect(fmtMs(65_000)).toBe('1m5s');
    expect(fmtMs(125_000)).toBe('2m5s'); // 2m + round(5000/1000)
  });
});

describe('fmtNum / pretty / ago / fmtCost', () => {
  it('fmtNum', () => {
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtNum(1234)).toBe((1234).toLocaleString());
    expect(fmtNum(0)).toBe('0');
  });

  it('pretty', () => {
    expect(pretty('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(pretty('not json')).toBe('not json');
    expect(pretty('')).toBe('');
  });

  it('ago', () => {
    const now = Date.now() / 1000;
    expect(ago(now - 5)).toBe('now');
    expect(ago(now - 59)).toBe('now');
    expect(ago(now - 60)).toBe('1m');
    expect(ago(now - 3600)).toBe('1h');
    expect(ago(now - 7200)).toBe('2h');
    expect(ago(now - 86_400)).toBe('1d');
    expect(ago(now - 172_800)).toBe('2d');
  });

  it('fmtCost', () => {
    expect(fmtCost(0.000123)).toBe('$0.00012'); // <0.01 → 5 decimals
    expect(fmtCost(0.01)).toBe('$0.010');
    expect(fmtCost(0.1234)).toBe('$0.123');
    expect(fmtCost(1.5)).toBe('$1.500');
  });
});
