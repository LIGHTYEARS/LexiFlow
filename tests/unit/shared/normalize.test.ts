import { describe, it, expect } from 'vitest';
import {
  normalizeForComparison,
  normalizeForDisplay,
  countCodePoints,
  hasLatinLetter,
} from '@shared/utils/normalize';

describe('normalizeForComparison', () => {
  it('folds case', () => {
    expect(normalizeForComparison('Hello')).toBe('hello');
  });

  it('collapses whitespace', () => {
    expect(normalizeForComparison('hello   world')).toBe('hello world');
  });

  it('trims', () => {
    expect(normalizeForComparison('  hello  ')).toBe('hello');
  });

  it('applies NFKC normalization', () => {
    // Full-width to half-width
    expect(normalizeForComparison('ＡＢＣ')).toBe('abc');
  });

  it('is idempotent', () => {
    const once = normalizeForComparison('Hello   World  ');
    const twice = normalizeForComparison(once);
    expect(once).toBe(twice);
  });
});

describe('normalizeForDisplay', () => {
  it('preserves case', () => {
    expect(normalizeForDisplay('Hello World')).toBe('Hello World');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeForDisplay('  hello   world  ')).toBe('hello world');
  });
});

describe('countCodePoints', () => {
  it('counts ASCII correctly', () => {
    expect(countCodePoints('hello')).toBe(5);
  });

  it('counts emoji as single code points', () => {
    expect(countCodePoints('hi 🎉')).toBe(4); // h, i, space, emoji
  });

  it('handles empty string', () => {
    expect(countCodePoints('')).toBe(0);
  });
});

describe('hasLatinLetter', () => {
  it('returns true for English text', () => {
    expect(hasLatinLetter('hello')).toBe(true);
  });

  it('returns true for mixed text', () => {
    expect(hasLatinLetter('123abc')).toBe(true);
  });

  it('returns false for pure numbers', () => {
    expect(hasLatinLetter('12345')).toBe(false);
  });

  it('returns false for pure punctuation', () => {
    expect(hasLatinLetter('...!!!')).toBe(false);
  });

  it('returns false for pure CJK', () => {
    expect(hasLatinLetter('你好世界')).toBe(false);
  });
});
