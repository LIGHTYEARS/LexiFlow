import { createError } from '@shared/protocol/envelope';

/**
 * RiskPolicy — the service-side guard for PRD §10.2 (must-confirm) and §10.3
 * (forbidden) operations. Per technical-design/06 §10 this re-validates on the
 * service side, not just at the button, so a caller cannot bypass confirmation
 * by crafting a message.
 *
 * Confirmation tokens are minted for a specific operation signature and must be
 * echoed back by the caller to prove the user saw and confirmed the impact.
 */

/** Operations that require explicit user confirmation (§10.2). */
export const MUST_CONFIRM_OPERATIONS = [
  'card.merge',
  'card.add-sense',
  'card.edit-core',
  'card.change-type',
  'card.pause',
  'card.archive',
  'card.delete',
  'inbox.discard',
  'inbox.batch-promote',
  'tags.bulk-modify',
  'practice.affect-fsrs',
  'data.clear-inbox',
  'data.clear-all',
  'data.import',
] as const;

export type MustConfirmOperation = (typeof MUST_CONFIRM_OPERATIONS)[number];

/** Operations that must NEVER be performed automatically (§10.3). */
export const FORBIDDEN_AUTO_OPERATIONS = [
  'card.hard-delete',
  'kb.mass-rewrite',
  'notes.overwrite-user',
  'history.clear',
  'progress.reset',
  'data.wipe-silent',
  'source.replace-with-model',
] as const;

const tokenStore = new Map<string, { operation: string; signature: string; expiresAt: number }>();
const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Mint a confirmation token for an operation + signature (e.g. entity ids).
 * The UI shows the impact, then passes this token to the apply call.
 */
export function mintConfirmationToken(operation: MustConfirmOperation, signature: string): string {
  const token = crypto.randomUUID();
  tokenStore.set(token, { operation, signature, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/**
 * Validate a confirmation token for an operation + signature. Consumes it on
 * success (single use). Throws PERMISSION_DENIED if missing/invalid/expired.
 */
export function requireConfirmation(
  operation: MustConfirmOperation,
  signature: string,
  token: string | undefined,
): void {
  if (!token) {
    throw createError('PERMISSION_DENIED', `Operation "${operation}" requires confirmation`, false);
  }
  const entry = tokenStore.get(token);
  if (!entry || entry.operation !== operation || entry.signature !== signature) {
    throw createError('PERMISSION_DENIED', 'Confirmation token is invalid for this operation', false);
  }
  if (entry.expiresAt < Date.now()) {
    tokenStore.delete(token);
    throw createError('PERMISSION_DENIED', 'Confirmation token has expired; please retry', true);
  }
  tokenStore.delete(token);
}

/** Assert an operation is not in the forbidden-auto set. */
export function assertNotForbidden(operation: string): void {
  if ((FORBIDDEN_AUTO_OPERATIONS as readonly string[]).includes(operation)) {
    throw createError('PERMISSION_DENIED', `Operation "${operation}" can never be performed automatically`, false);
  }
}

/** Stable signature from a set of entity ids (order-independent). */
export function signatureFor(ids: string[]): string {
  return [...ids].sort().join('|');
}
