import { describe, it, expect } from 'vitest';
import {
  mintConfirmationToken,
  requireConfirmation,
  assertNotForbidden,
  signatureFor,
  MUST_CONFIRM_OPERATIONS,
  FORBIDDEN_AUTO_OPERATIONS,
} from '@app/safety/risk-policy';

describe('RiskPolicy', () => {
  it('accepts a valid confirmation token exactly once', () => {
    const sig = signatureFor(['a', 'b']);
    const token = mintConfirmationToken('card.merge', sig);
    expect(() => requireConfirmation('card.merge', sig, token)).not.toThrow();
    // Single use: a second call must fail.
    expect(() => requireConfirmation('card.merge', sig, token)).toThrow();
  });

  it('rejects a missing token', () => {
    expect(() => requireConfirmation('card.delete', 'x', undefined)).toThrow();
  });

  it('rejects a token minted for a different operation', () => {
    const token = mintConfirmationToken('card.merge', 'sig');
    expect(() => requireConfirmation('card.delete', 'sig', token)).toThrow();
  });

  it('rejects a token minted for a different signature', () => {
    const token = mintConfirmationToken('card.merge', 'sig-1');
    expect(() => requireConfirmation('card.merge', 'sig-2', token)).toThrow();
  });

  it('computes an order-independent signature', () => {
    expect(signatureFor(['b', 'a'])).toBe(signatureFor(['a', 'b']));
  });

  it('blocks forbidden auto operations', () => {
    expect(() => assertNotForbidden('card.hard-delete')).toThrow();
    expect(() => assertNotForbidden('notes.overwrite-user')).toThrow();
    expect(() => assertNotForbidden('card.merge')).not.toThrow();
  });

  it('keeps must-confirm and forbidden sets disjoint', () => {
    for (const op of MUST_CONFIRM_OPERATIONS) {
      expect(FORBIDDEN_AUTO_OPERATIONS as readonly string[]).not.toContain(op);
    }
  });
});
