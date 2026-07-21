import type { AiTaskType } from '@shared/protocol/protocol-map';

/**
 * TaskPolicy — selects model, prompt version, max context budget, and timeout per task type.
 * See technical-design/05 §4 (TaskPolicy component).
 *
 * Defaults are initial values; final defaults require product confirmation
 * (marked TBD in design doc §14).
 */

export interface TaskPolicyConfig {
  modelProfileId: string;
  promptVersion: string;
  maxContextTokens: number;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
}

const DEFAULT_POLICIES: Record<string, TaskPolicyConfig> = {
  'quick-explain': {
    modelProfileId: 'default',
    promptVersion: 'quick-explain-v1',
    maxContextTokens: 2000,
    timeoutMs: 15000,
    maxOutputTokens: 500,
    temperature: 0.3,
  },
  'full-analysis': {
    modelProfileId: 'default',
    promptVersion: 'full-analysis-v1',
    maxContextTokens: 4000,
    timeoutMs: 30000,
    maxOutputTokens: 1500,
    temperature: 0.3,
  },
  'inbox-reanalysis': {
    modelProfileId: 'default',
    promptVersion: 'inbox-reanalysis-v1',
    maxContextTokens: 3000,
    timeoutMs: 20000,
    maxOutputTokens: 800,
    temperature: 0.2,
  },
  'inbox-organize': {
    modelProfileId: 'default',
    promptVersion: 'inbox-organize-v1',
    maxContextTokens: 3000,
    timeoutMs: 20000,
    maxOutputTokens: 800,
    temperature: 0.2,
  },
  'practice-generate': {
    modelProfileId: 'default',
    promptVersion: 'practice-generate-v1',
    maxContextTokens: 3000,
    timeoutMs: 25000,
    maxOutputTokens: 1000,
    temperature: 0.5,
  },
};

/**
 * Get the policy configuration for a task type.
 * Falls back to the quick-explain policy for unknown task types.
 */
export function getTaskPolicy(taskType: AiTaskType | string): TaskPolicyConfig {
  return DEFAULT_POLICIES[taskType] || DEFAULT_POLICIES['quick-explain'];
}

/**
 * Build the prompt for a task type given the input.
 * Prompt templates are versioned; the promptVersion in the policy
 * determines which template is used.
 */
export function buildPrompt(
  taskType: AiTaskType | string,
  input: { selectedText: string; context?: string; pageTitle?: string },
): string {
  const context = input.context ? `\n\nContext:\n${input.context}` : '';
  const pageTitle = input.pageTitle ? `\n\nSource: ${input.pageTitle}` : '';

  switch (taskType) {
    case 'quick-explain':
      return [
        'Explain the following selected text for a Chinese learner of English.',
        'Provide: Chinese meaning, English meaning, context meaning, and 1-2 examples.',
        'Be concise. Do not use HTML.',
        '',
        `Selected text: "${input.selectedText}"`,
        context,
        pageTitle,
      ].join('\n');

    case 'full-analysis':
      return [
        'Provide a comprehensive analysis of the following text.',
        'Include: Chinese meaning, English meaning, full explanation, context meaning,',
        'examples, and suggest similar cards (id, text, relation).',
        'Do not use HTML.',
        '',
        `Selected text: "${input.selectedText}"`,
        context,
        pageTitle,
      ].join('\n');

    default:
      return [
        `Analyze: "${input.selectedText}"`,
        context,
        pageTitle,
      ].join('\n');
  }
}
