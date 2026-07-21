import { describe, it, expect } from 'vitest';
import { validateResult, type ValidationResult } from '@app/ai-task/result-validator';

describe('Result Validator', () => {
  describe('validateResult for quick-explain', () => {
    it('passes validation for valid quick-explain output', () => {
      const raw = {
        type: 'word' as const,
        chineseMeaning: '你好',
        englishMeaning: 'hello',
        contextMeaning: 'A casual greeting',
        examples: ['Hello there!'],
      };
      const result = validateResult('quick-explain', 'task-123', 'quick-explain-v1', raw);
      expect(result.valid).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.taskId).toBe('task-123');
      expect(result.result?.schemaVersion).toBe(1);
      expect(result.result?.value).toEqual(raw);
      expect(result.result?.provenance).toEqual({
        kind: 'model-generated',
        taskId: 'task-123',
        promptVersion: 'quick-explain-v1',
      });
    });

    it('passes validation for empty quick-explain output', () => {
      const result = validateResult('quick-explain', 'task-456', 'quick-explain-v1', {});
      expect(result.valid).toBe(true);
      expect(result.result?.value).toEqual({});
    });
  });

  describe('validateResult for full-analysis', () => {
    it('passes validation for valid full-analysis output', () => {
      const raw = {
        type: 'phrase' as const,
        chineseMeaning: '你好世界',
        englishMeaning: 'hello world',
        fullExplanation: 'A common greeting used in programming examples.',
        examples: ['Hello world is the first program.'],
        similarCards: [
          { id: 'c1', text: 'greeting', relation: 'synonym' },
        ],
      };
      const result = validateResult('full-analysis', 'task-789', 'full-analysis-v1', raw);
      expect(result.valid).toBe(true);
      expect(result.result?.taskId).toBe('task-789');
      expect(result.result?.schemaVersion).toBe(1);
      expect(result.result?.value).toEqual(raw);
      expect(result.result?.provenance.promptVersion).toBe('full-analysis-v1');
    });

    it('passes validation with only required fullExplanation field', () => {
      const raw = { fullExplanation: 'A detailed explanation.' };
      const result = validateResult('full-analysis', 'task-101', 'full-analysis-v1', raw);
      expect(result.valid).toBe(true);
    });
  });

  describe('INVALID_MODEL_OUTPUT for invalid results', () => {
    it('fails with INVALID_MODEL_OUTPUT for wrong field type', () => {
      const raw = { chineseMeaning: 12345 };
      const result = validateResult('quick-explain', 'task-err1', 'quick-explain-v1', raw);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
      expect(result.errorMessage).toContain('Model output failed schema validation');
      expect(result.result).toBeUndefined();
    });

    it('fails with INVALID_MODEL_OUTPUT for extra fields (strict schema)', () => {
      const raw = {
        chineseMeaning: '你好',
        unexpectedField: 'not allowed',
      };
      const result = validateResult('quick-explain', 'task-err2', 'quick-explain-v1', raw);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
    });

    it('fails with INVALID_MODEL_OUTPUT for invalid type enum', () => {
      const raw = { type: 'invalid_type' };
      const result = validateResult('quick-explain', 'task-err3', 'quick-explain-v1', raw);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
    });

    it('fails with INVALID_MODEL_OUTPUT for missing required field in full-analysis', () => {
      const raw = { chineseMeaning: '你好' };
      const result = validateResult('full-analysis', 'task-err4', 'full-analysis-v1', raw);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
    });

    it('fails with INVALID_MODEL_OUTPUT for non-object input', () => {
      const result = validateResult('quick-explain', 'task-err5', 'quick-explain-v1', 'not an object');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
    });

    it('fails with INVALID_MODEL_OUTPUT for null input', () => {
      const result = validateResult('quick-explain', 'task-err6', 'quick-explain-v1', null);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_MODEL_OUTPUT');
    });
  });

  describe('INVALID_INPUT for unknown task types', () => {
    it('fails with INVALID_INPUT for unknown task type', () => {
      const result = validateResult('unknown-type', 'task-x1', 'v1', { chineseMeaning: '你好' });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_INPUT');
      expect(result.errorMessage).toContain('No output schema defined for task type: unknown-type');
      expect(result.result).toBeUndefined();
    });

    it('fails with INVALID_INPUT for empty string task type', () => {
      const result = validateResult('', 'task-x2', 'v1', {});
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_INPUT');
    });

    it('fails with INVALID_INPUT for unsupported task type inbox-organize', () => {
      // inbox-organize is a valid AiTaskType but has no output schema yet
      const result = validateResult('inbox-organize', 'task-x3', 'v1', {});
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_INPUT');
    });
  });

  describe('ValidationResult type', () => {
    it('returns correct shape on success', () => {
      const result: ValidationResult = validateResult(
        'quick-explain',
        'task-type',
        'v1',
        { chineseMeaning: 'test' },
      );
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('result');
      expect(result.valid).toBe(true);
      expect(result.result).toBeDefined();
    });

    it('returns correct shape on failure', () => {
      const result: ValidationResult = validateResult(
        'quick-explain',
        'task-type',
        'v1',
        { invalid: 123 },
      );
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errorCode');
      expect(result).toHaveProperty('errorMessage');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBeDefined();
      expect(result.errorMessage).toBeDefined();
    });
  });
});
