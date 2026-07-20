import { describe, it, expect } from 'vitest';
import {
  deriveOriginPattern,
  isSupportedPage,
} from '@infra/permissions/page-access-policy';
import {
  validateModelBaseUrl,
  deriveModelOriginPattern,
  canMakeModelRequest,
} from '@infra/permissions/model-origin-gateway';

describe('PageAccessPolicy', () => {
  describe('deriveOriginPattern', () => {
    it('derives pattern from https URL', () => {
      expect(deriveOriginPattern('https://example.com/page')).toBe(
        'https://example.com/*',
      );
    });

    it('derives pattern with port', () => {
      expect(deriveOriginPattern('http://localhost:4000/api')).toBe(
        'http://localhost:4000/*',
      );
    });

    it('returns null for non-http URL', () => {
      expect(deriveOriginPattern('file:///path/to/file')).toBeNull();
    });

    it('returns null for invalid URL', () => {
      expect(deriveOriginPattern('not-a-url')).toBeNull();
    });
  });

  describe('isSupportedPage', () => {
    it('supports https pages', () => {
      expect(isSupportedPage('https://example.com')).toBe(true);
    });

    it('supports http pages', () => {
      expect(isSupportedPage('http://example.com')).toBe(true);
    });

    it('rejects chrome:// pages', () => {
      expect(isSupportedPage('chrome://extensions')).toBe(false);
    });

    it('rejects Chrome Web Store', () => {
      expect(isSupportedPage('https://chromewebstore.google.com/detail/xxx')).toBe(false);
    });

    it('rejects file:// pages', () => {
      expect(isSupportedPage('file:///home/user/page.html')).toBe(false);
    });

    it('rejects invalid URLs', () => {
      expect(isSupportedPage('not-a-url')).toBe(false);
    });
  });
});

describe('ModelOriginPermissionGateway', () => {
  describe('validateModelBaseUrl', () => {
    it('accepts valid https URL', () => {
      const result = validateModelBaseUrl('https://api.example.com/v1');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.origin).toBe('https://api.example.com');
      }
    });

    it('accepts localhost http URL', () => {
      const result = validateModelBaseUrl('http://localhost:4000');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.origin).toBe('http://localhost:4000');
      }
    });

    it('accepts 127.0.0.1 http URL', () => {
      const result = validateModelBaseUrl('http://127.0.0.1:8080');
      expect(result.valid).toBe(true);
    });

    it('rejects remote http URL', () => {
      const result = validateModelBaseUrl('http://api.example.com');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.code).toBe('INVALID_INPUT');
      }
    });

    it('rejects URL with userinfo', () => {
      const result = validateModelBaseUrl('https://user:pass@api.example.com');
      expect(result.valid).toBe(false);
    });

    it('rejects URL with query string', () => {
      const result = validateModelBaseUrl('https://api.example.com?q=1');
      expect(result.valid).toBe(false);
    });

    it('rejects URL with fragment', () => {
      const result = validateModelBaseUrl('https://api.example.com#frag');
      expect(result.valid).toBe(false);
    });

    it('rejects non-http(s) scheme', () => {
      const result = validateModelBaseUrl('ws://api.example.com');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid URL', () => {
      const result = validateModelBaseUrl('not-a-url');
      expect(result.valid).toBe(false);
    });
  });

  describe('deriveModelOriginPattern', () => {
    it('derives correct pattern', () => {
      expect(deriveModelOriginPattern('https://api.example.com/v1')).toBe(
        'https://api.example.com/*',
      );
    });

    it('returns null for invalid URL', () => {
      expect(deriveModelOriginPattern('invalid')).toBeNull();
    });
  });

  describe('canMakeModelRequest', () => {
    it('returns allowed when permission is granted', async () => {
      const result = await canMakeModelRequest('https://api.example.com');
      expect(result.allowed).toBe(true);
    });
  });
});
