import { z } from 'zod';

/**
 * Structured output schemas for AI tasks.
 * Used to validate model responses before they reach the UI or database.
 * See technical-design/05 §4 (StructuredResultValidator).
 */

export const QuickExplainResultSchema = z.object({
  type: z.enum(['word', 'phrase', 'sentence', 'technical_term']),
  chineseMeaning: z.string().default(''),
  englishMeaning: z.string().default(''),
  contextMeaning: z.string().optional(),
  examples: z.array(z.string()).default([]),
  confidence: z.enum(['exact', 'likely_same', 'possibly_related', 'insufficient_context']).default('insufficient_context'),
});

export type QuickExplainResult = z.infer<typeof QuickExplainResultSchema>;

export const SimilarCardAssessmentSchema = z.object({
  candidateCardId: z.string(),
  relation: z.enum([
    'exact_duplicate',
    'same_word_form',
    'same_expression_new_context',
    'same_word_different_sense',
    'expression_variant',
    'near_synonym',
    'antonym_or_confusable',
    'topic_related',
    'unrelated',
  ]),
  confidence: z.enum(['exact', 'likely_same', 'possibly_related', 'insufficient_context']),
  rationale: z.string().default(''),
});

export const SimilarCardsResultSchema = z.array(SimilarCardAssessmentSchema);

export type SimilarCardsResult = z.infer<typeof SimilarCardsResultSchema>;

/**
 * Validate and coerce a model's raw text output into a typed result.
 * Tries JSON parse first, then falls back to extracting JSON from text.
 */
export function parseStructuredOutput<T>(schema: z.ZodSchema<T>, rawText: string): { success: boolean; data?: T; error?: string } {
  const trimmed = rawText.trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(trimmed);
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: 'Schema validation failed: ' + result.error.message };
  } catch {
    // Not valid JSON — try to extract JSON object/array from text
    const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const result = schema.safeParse(parsed);
        if (result.success) {
          return { success: true, data: result.data };
        }
        return { success: false, error: 'Schema validation failed: ' + result.error.message };
      } catch {
        // fall through
      }
    }
    return { success: false, error: 'Model output was not valid JSON' };
  }
}
