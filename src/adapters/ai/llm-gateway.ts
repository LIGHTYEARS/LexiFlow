import { generateObject, streamText, APICallError } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';
import { getSettings } from '@infra/storage/settings-gateway';
import { getCredentialValue } from '@infra/storage/settings-gateway';
import { AI_RESULT_SCHEMAS } from './ai-result-schemas';
import type { AiResultTaskType } from './ai-result-schemas';
import type { ConnectionTestResult } from '@shared/protocol/protocol-map';

/**
 * LLMGateway — the ONLY module permitted to call the AI SDK / LiteLLM.
 * See technical-design/05 §4 (LiteLlmProviderFactory + StructuredResultValidator)
 * and §9 (credentials never leave trusted context; errors never leak secrets).
 *
 * Content scripts must never import this; it reads the credential and base URL.
 */

const DEFAULT_MODEL_ID = 'gpt-3.5-turbo';

/**
 * Classify an unknown error into a stable, credential-safe AppError.
 * Never includes the API key, full URL with auth, or raw response body.
 */
export function classifyModelError(error: unknown): AppError {
  // AbortError → cancelled/timeout is handled by the coordinator; here treat as cancelled.
  if (error instanceof DOMException && error.name === 'AbortError') {
    return createError('CANCELLED', 'The request was cancelled', false);
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return createError('TIMEOUT', 'The model request timed out', true);
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) {
      return createError('PERMISSION_DENIED', 'Authentication failed (check your credential)', false);
    }
    if (status === 404) {
      return createError('MODEL_UNAVAILABLE', 'Model or endpoint not found', false);
    }
    if (status === 429) {
      return createError('MODEL_UNAVAILABLE', 'Model is rate-limited; try again shortly', true);
    }
    if (status !== undefined && status >= 500) {
      return createError('MODEL_UNAVAILABLE', 'The model service returned an error', true);
    }
    // No status → typically a network/DNS/connection failure (unreachable).
    if (status === undefined) {
      return createError('OFFLINE', 'Could not reach the model service', true);
    }
    return createError('MODEL_UNAVAILABLE', 'The model service returned an unexpected response', true);
  }

  // Zod validation failure of the structured output.
  if (error instanceof z.ZodError) {
    return createError('INVALID_INPUT', 'The model returned data in an unexpected shape', true);
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('no object generated') || msg.includes('could not parse') || msg.includes('schema')) {
      return createError('INVALID_INPUT', 'The model output could not be validated', true);
    }
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return createError('OFFLINE', 'Could not reach the model service', true);
    }
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
      return createError('TIMEOUT', 'The model request timed out', true);
    }
  }

  return createError('MODEL_UNAVAILABLE', 'The model request failed', true);
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

/**
 * Load provider config from trusted settings + stored credential.
 * Throws a credential-safe AppError if not configured.
 */
async function loadProviderConfig(taskModelId?: string): Promise<ProviderConfig> {
  const settings = await getSettings();
  const baseUrl = settings.model.baseUrl.trim();
  if (!baseUrl) {
    throw createError('INVALID_INPUT', 'No model endpoint configured. Set it in Settings.', false);
  }
  const credentialRef = settings.model.credentialRef;
  const apiKey = credentialRef ? (await getCredentialValue(credentialRef)) ?? '' : '';
  const modelId = taskModelId || DEFAULT_MODEL_ID;
  return { baseUrl, apiKey, modelId };
}

function makeModel(config: ProviderConfig) {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: config.baseUrl,
    apiKey: config.apiKey || undefined,
  });
  return provider(config.modelId);
}

export interface RunTaskParams<T extends AiResultTaskType> {
  taskType: T;
  system: string;
  userPrompt: string;
  modelId?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Run a structured AI task. Returns the Zod-validated result value.
 * Streaming deltas are handled separately by the coordinator; the terminal
 * value is always schema-validated here (§05 §6 step 6).
 */
export async function runStructuredTask<T extends AiResultTaskType>(
  params: RunTaskParams<T>,
): Promise<z.infer<(typeof AI_RESULT_SCHEMAS)[T]>> {
  const config = await loadProviderConfig(params.modelId);
  const model = makeModel(config);
  const schema = AI_RESULT_SCHEMAS[params.taskType];

  // Combine an external abort signal with the timeout.
  const timeoutSignal = AbortSignal.timeout(params.timeoutMs);
  const signal = params.signal
    ? anySignal([params.signal, timeoutSignal])
    : timeoutSignal;

  const { object } = await generateObject({
    model,
    schema: schema as z.ZodType,
    system: params.system,
    prompt: params.userPrompt,
    abortSignal: signal,
  });

  return object as z.infer<(typeof AI_RESULT_SCHEMAS)[T]>;
}

/**
 * Stream text deltas for display-only progress (§05 §6). The terminal
 * structured value still comes from runStructuredTask; this exists so the UI
 * can show "generating" motion where useful.
 */
export async function streamTaskText(params: {
  system: string;
  userPrompt: string;
  modelId?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  const config = await loadProviderConfig(params.modelId);
  const model = makeModel(config);
  const timeoutSignal = AbortSignal.timeout(params.timeoutMs);
  const signal = params.signal ? anySignal([params.signal, timeoutSignal]) : timeoutSignal;
  const result = streamText({
    model,
    system: params.system,
    prompt: params.userPrompt,
    abortSignal: signal,
  });
  for await (const delta of result.textStream) {
    params.onDelta(delta);
  }
}

/**
 * Connection test (PRD §14.1). Distinguishes unreachable / auth / timeout /
 * model-unavailable without exposing the credential in the message.
 */
export async function testConnection(): Promise<ConnectionTestResult> {
  const started = performance.now();
  try {
    const config = await loadProviderConfig();
    const model = makeModel(config);
    await generateObject({
      model,
      schema: z.object({ ok: z.boolean() }),
      system: 'Reply with {"ok": true}. This is a connectivity test.',
      prompt: 'ping',
      abortSignal: AbortSignal.timeout(10000),
    });
    return { ok: true, message: 'Connection successful', latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    const appError = classifyModelError(error);
    return {
      ok: false,
      code: appError.code,
      message: connectionMessageFor(appError.code),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function connectionMessageFor(code: string): string {
  switch (code) {
    case 'OFFLINE':
      return 'Cannot reach the endpoint — check the base URL and that the service is running.';
    case 'PERMISSION_DENIED':
      return 'Authentication failed — check your API credential.';
    case 'TIMEOUT':
      return 'The connection timed out.';
    case 'MODEL_UNAVAILABLE':
      return 'The endpoint is reachable but the model is unavailable.';
    case 'INVALID_INPUT':
      return 'No endpoint configured, or the response was not understood.';
    default:
      return 'Connection failed.';
  }
}

/**
 * Combine multiple AbortSignals into one (aborts when any aborts).
 * AbortSignal.any exists in modern runtimes; provide a fallback for safety.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
