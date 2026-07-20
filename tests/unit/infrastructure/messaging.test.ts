import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateEnvelope,
  ok,
  fail,
  createError,
  MAX_MESSAGE_PAYLOAD_BYTES,
} from '@shared/protocol/envelope';
import { messageRegistry } from '@infra/messaging/message-registry';
import { validateSender, validatePayloadSize, mapError } from '@infra/messaging/browser-runtime';

describe('Message Envelope', () => {
  describe('validateEnvelope', () => {
    it('accepts valid envelope', () => {
      const envelope = {
        protocolVersion: 1 as const,
        type: 'test/command',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { foo: 'bar' },
      };
      expect(validateEnvelope(envelope)).toEqual(envelope);
    });

    it('rejects wrong protocol version', () => {
      const envelope = {
        protocolVersion: 2,
        type: 'test/command',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      };
      expect(() => validateEnvelope(envelope)).toThrow();
    });

    it('rejects invalid requestId', () => {
      const envelope = {
        protocolVersion: 1,
        type: 'test/command',
        requestId: 'not-a-uuid',
        occurredAt: new Date().toISOString(),
        payload: {},
      };
      expect(() => validateEnvelope(envelope)).toThrow();
    });

    it('rejects missing type', () => {
      const envelope = {
        protocolVersion: 1,
        type: '',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      };
      expect(() => validateEnvelope(envelope)).toThrow();
    });

    it('rejects invalid datetime', () => {
      const envelope = {
        protocolVersion: 1,
        type: 'test/command',
        requestId: crypto.randomUUID(),
        occurredAt: 'not-a-date',
        payload: {},
      };
      expect(() => validateEnvelope(envelope)).toThrow();
    });
  });

  describe('ok/fail helpers', () => {
    it('creates success result', () => {
      const result = ok('req-123', { value: 42 });
      expect(result).toEqual({ ok: true, requestId: 'req-123', data: { value: 42 } });
    });

    it('creates failure result', () => {
      const error = createError('INVALID_INPUT', 'Bad input');
      const result = fail('req-123', error);
      expect(result).toEqual({ ok: false, requestId: 'req-123', error });
    });
  });

  describe('createError', () => {
    it('creates error with diagnostic ID', () => {
      const error = createError('TIMEOUT', 'Timed out', true);
      expect(error.code).toBe('TIMEOUT');
      expect(error.userMessage).toBe('Timed out');
      expect(error.retryable).toBe(true);
      expect(error.diagnosticId).toBeDefined();
    });
  });
});

describe('Message Registry', () => {
  beforeEach(() => {
    // Reset registry for clean test state
    messageRegistry['handlers'].clear();
  });

  it('registers and handles a message', async () => {
    messageRegistry.register('test/echo', async (payload, envelope) => {
      return ok(envelope.requestId, payload);
    });

    const envelope = {
      protocolVersion: 1 as const,
      type: 'test/echo',
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { hello: 'world' },
    };

    const sender = { id: chrome.runtime.id, url: 'chrome-extension://test/popup.html' };
    const result = await messageRegistry.handle(envelope, sender as unknown as chrome.runtime.MessageSender);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ hello: 'world' });
    }
  });

  it('rejects invalid envelope', async () => {
    const sender = { id: chrome.runtime.id };
    const result = await messageRegistry.handle({ invalid: true }, sender as unknown as chrome.runtime.MessageSender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects message from unknown extension', async () => {
    const envelope = {
      protocolVersion: 1 as const,
      type: 'test/command',
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {},
    };
    const sender = { id: 'different-extension-id' };
    const result = await messageRegistry.handle(envelope, sender as unknown as chrome.runtime.MessageSender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('rejects unknown message type', async () => {
    const envelope = {
      protocolVersion: 1 as const,
      type: 'unknown/type',
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {},
    };
    const sender = { id: chrome.runtime.id };
    const result = await messageRegistry.handle(envelope, sender as unknown as chrome.runtime.MessageSender);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('maps handler errors to AppError', async () => {
    messageRegistry.register('test/throw', async () => {
      throw new Error('Something went wrong');
    });

    const envelope = {
      protocolVersion: 1 as const,
      type: 'test/throw',
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {},
    };
    const sender = { id: chrome.runtime.id };
    const result = await messageRegistry.handle(envelope, sender as unknown as chrome.runtime.MessageSender);
    expect(result.ok).toBe(false);
  });

  it('reports registered types', () => {
    messageRegistry.register('test/a', async () => ok('1', undefined));
    messageRegistry.register('test/b', async () => ok('1', undefined));
    expect(messageRegistry.getRegisteredTypes()).toContain('test/a');
    expect(messageRegistry.getRegisteredTypes()).toContain('test/b');
    expect(messageRegistry.has('test/a')).toBe(true);
    expect(messageRegistry.has('test/c')).toBe(false);
  });
});

describe('validateSender', () => {
  it('accepts message from own extension', () => {
    const result = validateSender({ id: chrome.runtime.id } as unknown as chrome.runtime.MessageSender);
    expect(result.valid).toBe(true);
  });

  it('rejects message from different extension', () => {
    const result = validateSender({ id: 'other-extension' } as unknown as chrome.runtime.MessageSender);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('accepts content script message with tab', () => {
    const result = validateSender({
      id: chrome.runtime.id,
      url: 'https://example.com/page',
      tab: { id: 5 },
    } as unknown as chrome.runtime.MessageSender);
    expect(result.valid).toBe(true);
  });
});

describe('validatePayloadSize', () => {
  it('accepts small payload', () => {
    expect(validatePayloadSize({ data: 'hello' }).valid).toBe(true);
  });

  it('rejects oversized payload', () => {
    const large = { data: 'x'.repeat(MAX_MESSAGE_PAYLOAD_BYTES + 1) };
    const result = validatePayloadSize(large);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('mapError', () => {
  it('passes through AppError', () => {
    const appError = createError('TIMEOUT', 'Timed out');
    expect(mapError(appError)).toBe(appError);
  });

  it('maps DOMException timeout', () => {
    const err = new DOMException('Timed out', 'TimeoutError');
    const result = mapError(err);
    expect(result.code).toBe('TIMEOUT');
  });

  it('maps DOMException abort', () => {
    const err = new DOMException('Aborted', 'AbortError');
    const result = mapError(err);
    expect(result.code).toBe('CANCELLED');
  });

  it('maps generic Error', () => {
    const err = new Error('Something failed');
    const result = mapError(err);
    expect(result.code).toBe('INTERNAL');
  });

  it('maps permission-related message', () => {
    const err = new Error('Permission denied for operation');
    const result = mapError(err);
    expect(result.code).toBe('PERMISSION_DENIED');
  });
});
