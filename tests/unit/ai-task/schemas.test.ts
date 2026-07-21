import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  QuickExplainResultSchema,
  FullAnalysisResultSchema,
  TASK_OUTPUT_SCHEMAS,
  getOutputSchema,
} from '@app/ai-task/schemas';

describe('AI Task Output Schemas', () => {
  describe('QuickExplainResultSchema', () => {
    it('accepts valid data with all fields', () => {
      const data = {
        type: 'word' as const,
        chineseMeaning: '你好',
        englishMeaning: 'hello',
        fullExplanation: 'A greeting',
        contextMeaning: 'Used as a casual greeting',
        examples: ['Hello, how are you?', 'Say hello to everyone.'],
      };
      const result = QuickExplainResultSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('accepts minimal data (all fields optional)', () => {
      const result = QuickExplainResultSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts partial fields', () => {
      const result = QuickExplainResultSchema.safeParse({
        chineseMeaning: '你好',
      });
      expect(result.success).toBe(true);
    });

    it('rejects extra fields (strict schema)', () => {
      const data = {
        chineseMeaning: '你好',
        extraField: 'should not be here',
      };
      const result = QuickExplainResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid type enum value', () => {
      const data = {
        type: 'invalid_type',
      };
      const result = QuickExplainResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid field types', () => {
      const data = {
        chineseMeaning: 123,
      };
      const result = QuickExplainResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects non-array examples', () => {
      const data = {
        examples: 'not an array',
      };
      const result = QuickExplainResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('accepts all valid type enum values', () => {
      const types: Array<'word' | 'phrase' | 'sentence' | 'technical_term'> = [
        'word',
        'phrase',
        'sentence',
        'technical_term',
      ];
      for (const type of types) {
        const result = QuickExplainResultSchema.safeParse({ type });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('FullAnalysisResultSchema', () => {
    it('accepts valid data with all fields', () => {
      const data = {
        type: 'phrase' as const,
        chineseMeaning: '你好世界',
        englishMeaning: 'hello world',
        fullExplanation: 'A common greeting phrase used worldwide.',
        contextMeaning: 'Used in programming examples',
        examples: ['Hello world program.'],
        similarCards: [
          { id: 'card-1', text: 'hello', relation: 'synonym' },
        ],
      };
      const result = FullAnalysisResultSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('accepts minimal data (only fullExplanation required)', () => {
      const data = {
        fullExplanation: 'A detailed explanation.',
      };
      const result = FullAnalysisResultSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects missing required field fullExplanation', () => {
      const data = {
        chineseMeaning: '你好',
      };
      const result = FullAnalysisResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects extra fields (strict schema)', () => {
      const data = {
        fullExplanation: 'A detailed explanation.',
        unknownField: 'not allowed',
      };
      const result = FullAnalysisResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid similarCards structure', () => {
      const data = {
        fullExplanation: 'A detailed explanation.',
        similarCards: [{ id: 'card-1' }],
      };
      const result = FullAnalysisResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid type enum value', () => {
      const data = {
        fullExplanation: 'A detailed explanation.',
        type: 'invalid_type',
      };
      const result = FullAnalysisResultSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('TASK_OUTPUT_SCHEMAS', () => {
    it('contains quick-explain schema', () => {
      expect(TASK_OUTPUT_SCHEMAS['quick-explain']).toBeDefined();
      expect(TASK_OUTPUT_SCHEMAS['quick-explain']).toBe(QuickExplainResultSchema);
    });

    it('contains full-analysis schema', () => {
      expect(TASK_OUTPUT_SCHEMAS['full-analysis']).toBeDefined();
      expect(TASK_OUTPUT_SCHEMAS['full-analysis']).toBe(FullAnalysisResultSchema);
    });
  });

  describe('getOutputSchema', () => {
    it('returns QuickExplainResultSchema for quick-explain', () => {
      const schema = getOutputSchema('quick-explain');
      expect(schema).toBeDefined();
      expect(schema).toBe(QuickExplainResultSchema);
    });

    it('returns FullAnalysisResultSchema for full-analysis', () => {
      const schema = getOutputSchema('full-analysis');
      expect(schema).toBeDefined();
      expect(schema).toBe(FullAnalysisResultSchema);
    });

    it('returns undefined for unknown task type', () => {
      const schema = getOutputSchema('unknown-type');
      expect(schema).toBeUndefined();
    });

    it('returned schema can validate data', () => {
      const schema = getOutputSchema('quick-explain');
      expect(schema).toBeDefined();
      if (schema) {
        const result = schema.safeParse({ chineseMeaning: '你好' });
        expect(result.success).toBe(true);
      }
    });
  });
});
