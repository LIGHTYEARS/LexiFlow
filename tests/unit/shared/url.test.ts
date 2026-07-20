import { describe, it, expect } from 'vitest';
import {
  canonicalizeUrl,
  getOrigin,
  isHttpUrl,
  removeFragment,
} from '@shared/utils/url';

describe('canonicalizeUrl', () => {
  it('removes fragment', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe(
      'https://example.com/page',
    );
  });

  it('removes default https port', () => {
    expect(canonicalizeUrl('https://example.com:443/path')).toBe(
      'https://example.com/path',
    );
  });

  it('removes default http port', () => {
    expect(canonicalizeUrl('http://example.com:80/path')).toBe(
      'http://example.com/path',
    );
  });

  it('preserves non-default port', () => {
    expect(canonicalizeUrl('https://example.com:8080/path')).toBe(
      'https://example.com:8080/path',
    );
  });

  it('lowercases host', () => {
    expect(canonicalizeUrl('https://EXAMPLE.COM/Path')).toBe(
      'https://example.com/Path',
    );
  });

  it('preserves query by default', () => {
    expect(canonicalizeUrl('https://example.com/?q=test&page=1')).toBe(
      'https://example.com/?q=test&page=1',
    );
  });

  it('throws for invalid URL', () => {
    expect(() => canonicalizeUrl('not-a-url')).toThrow();
  });
});

describe('getOrigin', () => {
  it('extracts origin', () => {
    expect(getOrigin('https://example.com:8080/path?q=1')).toBe(
      'https://example.com:8080',
    );
  });

  it('returns null for invalid URL', () => {
    expect(getOrigin('invalid')).toBeNull();
  });
});

describe('isHttpUrl', () => {
  it('accepts http', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
  });

  it('accepts https', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
  });

  it('rejects file', () => {
    expect(isHttpUrl('file:///path/to/file')).toBe(false);
  });

  it('rejects invalid', () => {
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('removeFragment', () => {
  it('removes fragment', () => {
    expect(removeFragment('https://example.com/page#frag')).toBe(
      'https://example.com/page',
    );
  });

  it('preserves query', () => {
    expect(removeFragment('https://example.com/?q=1#frag')).toBe(
      'https://example.com/?q=1',
    );
  });
});
