import { z } from 'zod';

/**
 * InboxItem — a safe buffer between capture and the formal knowledge base.
 * See PRD §9.3-9.4 and technical-design/04 §5.3.
 */
export const InboxItemSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['pending', 'processing', 'resolved', 'discarded']),
  sourceCaptureId: z.string().uuid(),
  draft: z.unknown().optional(),
  suggestions: z.array(z.unknown()).optional(),
  failure: z
    .object({
      code: z.string(),
      userMessage: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  resolvedByOperationId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;

/**
 * Inbox status transitions:
 * pending ↔ paused → processing → pending (retry) → resolved → discarded
 * See technical-design/06 §7.
 */
export type InboxStatus = InboxItem['status'];
