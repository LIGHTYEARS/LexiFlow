import { z } from 'zod';
import { fail, createError } from '@shared/protocol/envelope';
import type { AppResult, MessageEnvelope } from '@shared/protocol/envelope';

/**
 * Validate a message payload against a Zod schema, returning either the parsed
 * value or a ready-to-return INVALID_INPUT AppResult.
 *
 * This closes the gap where handlers hand-rolled `typeof`/`in` checks: every
 * handler that accepts input should narrow its payload through here so payloads
 * are Zod-validated end to end (README principle #3).
 */
export function parsePayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  envelope: MessageEnvelope,
): { ok: true; value: T } | { ok: false; result: AppResult<never> } {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      result: fail(
        envelope.requestId,
        createError('INVALID_INPUT', 'Invalid payload: ' + parsed.error.issues[0]?.message, false),
      ),
    };
  }
  return { ok: true, value: parsed.data };
}
