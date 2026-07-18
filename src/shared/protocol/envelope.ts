import { z } from 'zod';

/**
 * Cross-context message envelope. All commands and events use this versioned envelope.
 * See technical-design/01 §6 for the full contract.
 */
export const MessageEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  type: z.string(),
  requestId: z.string().uuid(),
  tabId: z.number().optional(),
  occurredAt: z.string().datetime(),
  payload: z.unknown(),
});

export type MessageEnvelope<TType extends string = string, TPayload = unknown> = {
  protocolVersion: 1;
  type: TType;
  requestId: string;
  tabId?: number;
  occurredAt: string;
  payload: TPayload;
};

/**
 * Unified result type for all cross-context responses.
 */
export type AppResult<T> =
  | { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string; error: AppError };

/**
 * Application error codes. These are stable, user-facing categories.
 * The actual error message is generated in the UI layer.
 */
export const AppErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'CONFLICT',
  'OFFLINE',
  'TIMEOUT',
  'CANCELLED',
  'MODEL_UNAVAILABLE',
  'STORAGE_FAILURE',
  'INTERRUPTED',
  'UPGRADING',
  'INTERNAL',
]);

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

export type AppError = {
  code: AppErrorCode;
  userMessage: string;
  retryable: boolean;
  diagnosticId?: string;
};

/**
 * Helper to create a successful result.
 */
export function ok<T>(requestId: string, data: T): AppResult<T> {
  return { ok: true, requestId, data };
}

/**
 * Helper to create a failed result.
 */
export function fail(requestId: string, error: AppError): AppResult<never> {
  return { ok: false, requestId, error };
}
