import { z } from 'zod';

/**
 * SourcePage — a webpage from which content was captured.
 * See technical-design/04 §5.2.
 */
export const SourcePageSchema = z.object({
  id: z.string().uuid(),
  canonicalKey: z.string(),
  url: z.string().url(),
  title: z.string(),
  siteName: z.string().optional(),
  domain: z.string(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});

export type SourcePage = z.infer<typeof SourcePageSchema>;

/**
 * SourceCapture — an immutable snapshot of a selection at capture time.
 * This is the raw evidence that can never be overwritten by model output.
 * See technical-design/04 §5.2.
 */
export const SourceCaptureSchema = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  selectedText: z.string(),
  context: z.object({
    sentenceBefore: z.string().optional(),
    sentenceContaining: z.string().optional(),
    sentenceAfter: z.string().optional(),
    paragraphExcerpt: z.string().optional(),
    nearestHeading: z.string().optional(),
    pageTitle: z.string(),
    url: z.string().url(),
    canonicalUrl: z.string().url().optional(),
    siteName: z.string().optional(),
    extractedAt: z.string().datetime(),
    quality: z.enum(['full', 'partial', 'selection_only']),
    omissions: z.array(z.string()).optional(),
  }),
  capturedAt: z.string().datetime(),
  contentHash: z.string(),
  captureRequestId: z.string().uuid(),
});

export type SourceCapture = z.infer<typeof SourceCaptureSchema>;

/**
 * CardSourceLink — links a card to a source capture with a role.
 * See technical-design/04 §5.2.
 */
export const CardSourceLinkSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  sourceCaptureId: z.string().uuid(),
  role: z.enum(['origin', 'additional_context', 'example']),
  createdAt: z.string().datetime(),
});

export type CardSourceLink = z.infer<typeof CardSourceLinkSchema>;
