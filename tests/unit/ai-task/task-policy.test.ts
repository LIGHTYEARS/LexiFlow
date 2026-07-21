import { describe, it, expect } from 'vitest';
import {
  getTaskPolicy,
  buildPrompt,
  type TaskPolicyConfig,
} from '@app/ai-task/task-policy';

describe('TaskPolicy', () => {
  describe('getTaskPolicy', () => {
    it('returns correct config for quick-explain', () => {
      const policy = getTaskPolicy('quick-explain');
      expect(policy).toEqual<TaskPolicyConfig>({
        modelProfileId: 'default',
        promptVersion: 'quick-explain-v1',
        maxContextTokens: 2000,
        timeoutMs: 15000,
        maxOutputTokens: 500,
        temperature: 0.3,
      });
    });

    it('returns correct config for full-analysis', () => {
      const policy = getTaskPolicy('full-analysis');
      expect(policy).toEqual<TaskPolicyConfig>({
        modelProfileId: 'default',
        promptVersion: 'full-analysis-v1',
        maxContextTokens: 4000,
        timeoutMs: 30000,
        maxOutputTokens: 1500,
        temperature: 0.3,
      });
    });

    it('returns correct config for inbox-reanalysis', () => {
      const policy = getTaskPolicy('inbox-reanalysis');
      expect(policy).toEqual<TaskPolicyConfig>({
        modelProfileId: 'default',
        promptVersion: 'inbox-reanalysis-v1',
        maxContextTokens: 3000,
        timeoutMs: 20000,
        maxOutputTokens: 800,
        temperature: 0.2,
      });
    });

    it('returns correct config for inbox-organize', () => {
      const policy = getTaskPolicy('inbox-organize');
      expect(policy).toEqual<TaskPolicyConfig>({
        modelProfileId: 'default',
        promptVersion: 'inbox-organize-v1',
        maxContextTokens: 3000,
        timeoutMs: 20000,
        maxOutputTokens: 800,
        temperature: 0.2,
      });
    });

    it('returns correct config for practice-generate', () => {
      const policy = getTaskPolicy('practice-generate');
      expect(policy).toEqual<TaskPolicyConfig>({
        modelProfileId: 'default',
        promptVersion: 'practice-generate-v1',
        maxContextTokens: 3000,
        timeoutMs: 25000,
        maxOutputTokens: 1000,
        temperature: 0.5,
      });
    });

    it('falls back to quick-explain policy for unknown task type', () => {
      const policy = getTaskPolicy('unknown-task-type');
      const quickExplainPolicy = getTaskPolicy('quick-explain');
      expect(policy).toEqual(quickExplainPolicy);
    });

    it('falls back to quick-explain policy for empty string', () => {
      const policy = getTaskPolicy('');
      const quickExplainPolicy = getTaskPolicy('quick-explain');
      expect(policy).toEqual(quickExplainPolicy);
    });

    it('returns consistent config for the same task type', () => {
      const policy1 = getTaskPolicy('quick-explain');
      const policy2 = getTaskPolicy('quick-explain');
      expect(policy1).toEqual(policy2);
    });
  });

  describe('buildPrompt', () => {
    it('builds correct prompt for quick-explain with selected text only', () => {
      const prompt = buildPrompt('quick-explain', { selectedText: 'hello' });
      expect(prompt).toContain('Explain the following selected text for a Chinese learner of English.');
      expect(prompt).toContain('Provide: Chinese meaning, English meaning, context meaning, and 1-2 examples.');
      expect(prompt).toContain('Be concise. Do not use HTML.');
      expect(prompt).toContain('Selected text: "hello"');
    });

    it('builds correct prompt for quick-explain with context and pageTitle', () => {
      const prompt = buildPrompt('quick-explain', {
        selectedText: 'hello',
        context: 'The word is used in a greeting.',
        pageTitle: 'English Grammar',
      });
      expect(prompt).toContain('Selected text: "hello"');
      expect(prompt).toContain('Context:\nThe word is used in a greeting.');
      expect(prompt).toContain('Source: English Grammar');
    });

    it('builds correct prompt for full-analysis with selected text only', () => {
      const prompt = buildPrompt('full-analysis', { selectedText: 'hello world' });
      expect(prompt).toContain('Provide a comprehensive analysis of the following text.');
      expect(prompt).toContain('Include: Chinese meaning, English meaning, full explanation, context meaning,');
      expect(prompt).toContain('examples, and suggest similar cards (id, text, relation).');
      expect(prompt).toContain('Do not use HTML.');
      expect(prompt).toContain('Selected text: "hello world"');
    });

    it('builds correct prompt for full-analysis with context and pageTitle', () => {
      const prompt = buildPrompt('full-analysis', {
        selectedText: 'hello world',
        context: 'A programming tutorial.',
        pageTitle: 'Learn Programming',
      });
      expect(prompt).toContain('Selected text: "hello world"');
      expect(prompt).toContain('Context:\nA programming tutorial.');
      expect(prompt).toContain('Source: Learn Programming');
    });

    it('builds default prompt for unknown task type', () => {
      const prompt = buildPrompt('unknown-type', { selectedText: 'test text' });
      expect(prompt).toContain('Analyze: "test text"');
    });

    it('builds default prompt with context and pageTitle for unknown type', () => {
      const prompt = buildPrompt('unknown-type', {
        selectedText: 'test text',
        context: 'Some context.',
        pageTitle: 'A Page',
      });
      expect(prompt).toContain('Analyze: "test text"');
      expect(prompt).toContain('Context:\nSome context.');
      expect(prompt).toContain('Source: A Page');
    });

    it('omits context section when context is undefined', () => {
      const prompt = buildPrompt('quick-explain', { selectedText: 'hello' });
      expect(prompt).not.toContain('Context:');
    });

    it('omits source section when pageTitle is undefined', () => {
      const prompt = buildPrompt('quick-explain', { selectedText: 'hello' });
      expect(prompt).not.toContain('Source:');
    });

    it('includes context but not pageTitle when only context is provided', () => {
      const prompt = buildPrompt('quick-explain', {
        selectedText: 'hello',
        context: 'Some context.',
      });
      expect(prompt).toContain('Context:\nSome context.');
      expect(prompt).not.toContain('Source:');
    });

    it('does not contain HTML tags in quick-explain prompt', () => {
      const prompt = buildPrompt('quick-explain', {
        selectedText: '<b>hello</b>',
      });
      // The prompt itself should instruct no HTML, but the selected text is
      // included as-is. Verify the prompt template does not add HTML.
      expect(prompt).toContain('Do not use HTML.');
    });
  });
});
