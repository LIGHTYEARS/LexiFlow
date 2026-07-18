import { z } from 'zod';

/**
 * Zod schema for the cross-context message envelope.
 * All inbound messages are validated with safeParse before processing.
 * See technical-design/01 §6 and technical-design/02 §5.
 */
export const MessageEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  type: z.string().min(1),
  requestId: z.string().uuid(),
  tabId: z.number().int().optional(),
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
 * Application error codes — stable, user-facing categories.
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
 * AppError Zod schema for validation across boundaries.
 */
export const AppErrorSchema = z.object({
  code: AppErrorCodeSchema,
  userMessage: z.string(),
  retryable: z.boolean(),
  diagnosticId: z.string().optional(),
});

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

/**
 * Create an AppError with a generated diagnostic ID.
 */
export function createError(
  code: AppErrorCode,
  userMessage: string,
  retryable = false,
): AppError {
  return {
    code,
    userMessage,
    retryable,
    diagnosticId: crypto.randomUUID(),
  };
}

/**
 * Maximum message payload size (64 KiB). See technical-design/11 §5.
 */
export const MAX_MESSAGE_PAYLOAD_BYTES = 64 * 1024;

/**
 * Validate an incoming message envelope.
 * Returns the parsed envelope or throws with INVALID_INPUT.
 */
export function validateEnvelope(raw: unknown): MessageEnvelope {
  const result = MessageEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw createError(
      'INVALID_INPUT',
      'Message envelope validation failed: ' + result.error.message,
      false,
    );
  }
  return result.data as MessageEnvelope;
}
