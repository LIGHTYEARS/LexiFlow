import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

/**
 * LiteLlmProviderFactory — the ONLY component allowed to touch LiteLLM config.
 * Never exposes credentials, baseURL, or headers to callers.
 * See technical-design/05 §3.D1 and §4.
 */

export interface ModelProfile {
  id: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * Create a language model from a resolved model profile.
 * The caller must already have validated permission for the model origin.
 */
export function createModel(profile: ModelProfile): LanguageModelV4 {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: profile.baseUrl,
    apiKey: profile.apiKey,
  });
  return provider.chatModel(profile.modelId);
}

/**
 * Test the connection to a model profile.
 * Returns a redacted diagnostic (no credentials, no full response body).
 */
export async function testConnection(profile: ModelProfile): Promise<{
  ok: boolean;
  code?: string;
  message: string;
  latencyMs?: number;
}> {
  const start = Date.now();
  try {
    const model = createModel(profile);
    const { generateText } = await import('ai');
    await generateText({
      model,
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 10,
      temperature: 0,
    });
    return {
      ok: true,
      message: 'Connection successful',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    if (error instanceof Error) {
      const message = error.message;
      if (message.includes('401') || message.includes('auth')) {
        return { ok: false, code: 'PERMISSION_DENIED', message: 'Authentication failed', latencyMs };
      }
      if (message.includes('404') || message.includes('not found')) {
        return { ok: false, code: 'NOT_FOUND', message: 'Model not found', latencyMs };
      }
      if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
        return { ok: false, code: 'TIMEOUT', message: 'Connection timed out', latencyMs };
      }
      return { ok: false, code: 'MODEL_UNAVAILABLE', message: 'Connection failed', latencyMs };
    }
    return { ok: false, code: 'MODEL_UNAVAILABLE', message: 'Unknown error', latencyMs };
  }
}
