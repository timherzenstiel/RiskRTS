import { describe, it, expect } from 'vitest';
import { loadPixelScale } from '../src/game/store';
import { DEFAULT_PIXEL_SCALE } from '../src/render/api';

const from = (kv: Record<string, string>) => (k: string) => kv[k] ?? null;

describe('pixel scale setting', () => {
  it('defaults to Crisp (1×)', () => {
    expect(DEFAULT_PIXEL_SCALE).toBe(1);
    expect(loadPixelScale(from({}))).toBe(1);
  });
  it('reads the stored choice', () => {
    for (const v of ['0', '1', '2', '3']) expect(loadPixelScale(from({ f14px: v }))).toBe(Number(v));
  });
  it('carries over the old Ultra / High / Chunky setting', () => {
    expect(loadPixelScale(from({ f14q: '0' }))).toBe(0);
    expect(loadPixelScale(from({ f14q: '1' }))).toBe(2);
    expect(loadPixelScale(from({ f14q: '2' }))).toBe(3);
    expect(loadPixelScale(from({ f14q: '2', f14px: '1' }))).toBe(1);
  });
  it('ignores garbage', () => {
    expect(loadPixelScale(from({ f14px: '9' }))).toBe(1);
  });
});
