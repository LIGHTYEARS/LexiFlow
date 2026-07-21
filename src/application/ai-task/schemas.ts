import { z } from 'zod';

/**
 * AI Task output schemas — Zod validation for structured model output.
 * Terminal state must pass these schemas; incremental text (deltas) must NOT.
 * See technical-design/05 §4 (StructuredResultValidator) and §6.
 */

/**
 * Quick-explain output schema — matches ExplanationPopover's ExplanationContent.
 * Inapplicable fields are omitted (not filled with empty strings).
 * Output must NOT contain HTML, operational commands, or target DB IDs.
 */
export const QuickExplainResultSchema = z.object({
  type: z.enum(['word', 'phrase', 'sentence', 'technical_term']).optional(),
  chineseMeaning: z.string().optional(),
  englishMeaning: z.string().optional(),
  fullExplanation: z.string().optional(),
  contextMeaning: z.string().optional(),
  examples: z.array(z.string()).optional(),
}).strict();

export type QuickExplainResult = z.infer<typeof QuickExplainResultSchema>;

/**
 * Full-analysis output schema — deeper analysis with similar cards.
 */
export const FullAnalysisResultSchema = z.object({
  type: z.enum(['word', 'phrase', 'sentence', 'technical_term']).optional(),
  chineseMeaning: z.string().optional(),
  englishMeaning: z.string().optional(),
  fullExplanation: z.string(),
  contextMeaning: z.string().optional(),
  examples: z.array(z.string()).optional(),
  similarCards: z.array(z.object({
    id: z.string(),
    text: z.string(),
    relation: z.string(),
  })).optional(),
}).strict();

export type FullAnalysisResult = z.infer<typeof FullAnalysisResultSchema>;

/**
 * Map of task type to output schema.
 * The coordinator uses this to validate the terminal state.
 */
export const TASK_OUTPUT_SCHEMAS = {
  'quick-explain': QuickExplainResultSchema,
  'full-analysis': FullAnalysisResultSchema,
} as const;

/**
 * Get the output schema for a task type.
 * Returns undefined if no schema is defined (task type not yet supported).
 */
export function getOutputSchema(taskType: string): z.ZodType | undefined {
  return (TASK_OUTPUT_SCHEMAS as Record<string, z.ZodType>)[taskType];
}

/**
 * Get a JSON-serializable shape of the expected output for a task type.
 * Used to instruct the model to produce JSON matching this structure.
 */
export function getSchemaJsonShape(taskType: string): Record<string, unknown> {
  switch (taskType) {
    case 'quick-explain':
      return {
        type: 'word | phrase | sentence | technical_term (optional)',
        chineseMeaning: 'string (optional)',
        englishMeaning: 'string (optional)',
        fullExplanation: 'string (optional)',
        contextMeaning: 'string (optional)',
        examples: ['string (optional)'],
      };
    case 'full-analysis':
      return {
        type: 'word | phrase | sentence | technical_term (optional)',
        chineseMeaning: 'string (optional)',
        englishMeaning: 'string (optional)',
        fullExplanation: 'string (required)',
        contextMeaning: 'string (optional)',
        examples: ['string (optional)'],
        similarCards: [
          { id: 'string', text: 'string', relation: 'string' },
        ],
      };
    default:
      return { result: 'string' };
  }
}
