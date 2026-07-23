import type { UserSettings } from '@infra/storage/settings-schema';
import { DEFAULT_PROMPTS } from './default-prompts';
import type { AiResultTaskType } from './ai-result-schemas';

/**
 * TaskPolicy — resolves the model id, prompt, and timeout for a task type from
 * user settings (technical-design/05 §4). Per PRD §14.2 a user's custom prompt
 * takes precedence over the built-in default, and we surface whether the active
 * prompt is default or custom so the UI can show it.
 */

export interface ResolvedTaskPolicy {
  taskType: AiResultTaskType;
  /** Model id to pass to the provider, or undefined to use the connection default. */
  modelId?: string;
  system: string;
  promptVersion: string;
  isCustomPrompt: boolean;
  timeoutMs: number;
}

/**
 * Resolve the effective prompt for a task: a stored custom override wins,
 * otherwise the current default. Default upgrades never overwrite a custom
 * prompt because we only fall back to the default when no override exists.
 */
export function resolveTaskPrompt(
  taskType: AiResultTaskType,
  settings: UserSettings,
): { system: string; version: string; isCustom: boolean } {
  const override = settings.model.taskPrompts?.[taskType];
  if (override && override.system.trim().length > 0) {
    return { system: override.system, version: override.version, isCustom: true };
  }
  const def = DEFAULT_PROMPTS[taskType];
  return { system: def.system, version: def.version, isCustom: false };
}

export function resolveTaskPolicy(
  taskType: AiResultTaskType,
  settings: UserSettings,
): ResolvedTaskPolicy {
  const prompt = resolveTaskPrompt(taskType, settings);
  const modelId = settings.model.taskModels?.[taskType] || undefined;
  return {
    taskType,
    modelId,
    system: prompt.system,
    promptVersion: prompt.version,
    isCustomPrompt: prompt.isCustom,
    timeoutMs: settings.model.requestTimeoutMs ?? 30000,
  };
}
