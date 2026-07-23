import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel } from 'ai';
import { getSettings, getCredentialValue } from '@infra/storage/settings-gateway';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';

/**
 * LiteLlmProviderFactory — the ONLY component that touches LiteLLM config.
 * Builds an AI SDK OpenAI-compatible provider from user settings.
 * Never exposes credentials to callers.
 * See technical-design/05 §4 (LiteLlmProviderFactory).
 */

export type ModelProfile = {
  baseUrl: string;
  apiKey: string;
  modelId: string;
};

/**
 * Resolve the active model profile from settings + credential store.
 * Throws AppError if misconfigured.
 */
export async function resolveModelProfile(): Promise<ModelProfile> {
  const settings = await getSettings();
  if (!settings.model.baseUrl) {
    throw createError('INVALID_INPUT', 'LiteLLM base URL not configured. Set it in Settings.', false);
  }
  if (!settings.model.credentialRef) {
    throw createError('INVALID_INPUT', 'No API key configured. Set it in Settings.', false);
  }
  const apiKey = await getCredentialValue(settings.model.credentialRef);
  if (!apiKey) {
    throw createError('INVALID_INPUT', 'API key not found or could not be decrypted.', false);
  }
  const modelId = settings.model.taskModels['quick-explain'] || settings.model.taskModels['default'];
  if (!modelId) {
    throw createError('INVALID_INPUT', 'No model name configured. Set it in Settings.', false);
  }
  return { baseUrl: settings.model.baseUrl, apiKey, modelId };
}

/**
 * Fetch the list of available models from the LiteLLM /v1/models endpoint.
 */
export async function listAvailableModels(): Promise<string[]> {
  const settings = await getSettings();
  if (!settings.model.baseUrl) {
    throw createError('INVALID_INPUT', 'LiteLLM base URL not configured.', false);
  }
  if (!settings.model.credentialRef) {
    throw createError('INVALID_INPUT', 'No API key configured.', false);
  }
  const apiKey = await getCredentialValue(settings.model.credentialRef);
  if (!apiKey) {
    throw createError('INVALID_INPUT', 'API key not found.', false);
  }

  const url = settings.model.baseUrl.replace(/\/$/, '') + '/models';
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw createError('MODEL_UNAVAILABLE', `Failed to fetch models: ${response.status} ${response.statusText}`, true);
  }

  const data = await response.json();
  const models: string[] = (data?.data || [])
    .map((m: { id?: string }) => m?.id)
    .filter(Boolean);
  return models;
}

/**
 * Create an AI SDK language model for the given profile.
 */
export function createLanguageModel(profile: ModelProfile): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: profile.baseUrl,
    apiKey: profile.apiKey,
  });
  return provider(profile.modelId);
}

/**
 * Test the LiteLLM connection with a minimal request.
 * Returns latency in ms on success, or throws AppError on failure.
 */
export async function testConnection(): Promise<{ ok: boolean; latencyMs?: number; message: string; code?: string }> {
  const start = Date.now();
  try {
    const profile = await resolveModelProfile();
    const model = createLanguageModel(profile);
    const result = await generateText({
      model,
      prompt: 'Reply with the single word: ok',
      maxOutputTokens: 10,
      temperature: 0,
    });
    const latencyMs = Date.now() - start;
    const text = result.text.trim().toLowerCase();
    if (text.includes('ok')) {
      return { ok: true, latencyMs, message: 'Connection successful' };
    }
    return { ok: false, latencyMs, message: 'Model responded but did not return expected output' };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const appError = mapModelError(error);
    return { ok: false, latencyMs, message: appError.userMessage, code: appError.code };
  }
}

/**
 * Map raw SDK/network errors to AppError categories.
 * See technical-design/05 §6 (error mapping).
 */
export function mapModelError(error: unknown): AppError {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    const status = (err.statusCode ?? err.status) as number | undefined;
    const message = err.message ? String(err.message) : 'Unknown model error';

    if (status === 401 || status === 403) {
      return createError('PERMISSION_DENIED', 'Authentication failed. Check your API key.', false);
    }
    if (status === 404) {
      return createError('NOT_FOUND', 'Model or endpoint not found. Check the base URL and model name.', false);
    }
    if (status === 429) {
      return createError('TIMEOUT', 'Rate limited. Try again later.', true);
    }
    if (status !== undefined && status >= 500) {
      return createError('MODEL_UNAVAILABLE', 'Model service error. Try again later.', true);
    }
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return createError('CANCELLED', 'Request cancelled or timed out.', true);
    }
    if (message.includes('fetch') || message.includes('network') || message.includes('ENOTFOUND')) {
      return createError('OFFLINE', 'Cannot reach the LiteLLM server. Check the base URL and network.', true);
    }
  }
  return createError('MODEL_UNAVAILABLE', 'Model request failed: ' + (error instanceof Error ? error.message : String(error)), true);
}
