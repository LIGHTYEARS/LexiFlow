import { z } from 'zod';

import type { ContentOrigin } from '../types';

export type { ContentOrigin };

/**
 * Tag entity. See PRD §11.4 and technical-design/04 §5.4.
 */
export const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  normalizedName: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Tag = z.infer<typeof TagSchema>;

/**
 * CardRelation — a typed relationship between two cards.
 * See PRD §8.3 and technical-design/04 §5.4.
 */
export const CardRelationSchema = z.object({
  id: z.string().uuid(),
  fromCardId: z.string().uuid(),
  toCardId: z.string().uuid(),
  // Keep in sync with CardRelationType in ../types.ts
  type: z.enum([
    'variant',
    'synonym',
    'antonym',
    'confusable',
    'word_family',
    'pattern_usage',
    'related',
  ]),
  // Keep in sync with RelationDirection in ../types.ts
  direction: z.enum(['directed', 'symmetric']),
  // Keep in sync with ContentOrigin in ../types.ts
  origin: z.enum(['web_page', 'user', 'model', 'import']),
  note: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type CardRelation = z.infer<typeof CardRelationSchema>;
