import { generateObject } from 'ai';
import { createModel, type ModelProfile } from '@adapters/litellm/provider-factory';
import { getTaskPolicy, buildPrompt } from './task-policy';
import { validateResult } from './result-validator';
import { recordTaskStart, recordTaskTerminal } from './task-journal';
import type {
  AiTaskRequest,
  AiTaskState,
  AiTaskEvent,
} from '@shared/protocol/protocol-map';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';

/**
 * AiTaskCoordinator — the task state machine.
 * Owns: cancellation (AbortController), idempotency, stale-result suppression.
 * Runs in the background service worker (trusted context).
 * See technical-design/05 §4, §6, §7, §8.
 */

export interface TaskState {
  taskId: string;
  state: AiTaskState;
  progress: number;
  result?: unknown;
  error?: AppError;
  abortController?: AbortController;
  intentId: string;
  requestId: string;
  idempotencyKey: string;
}

const activeTasks = new Map<string, TaskState>();

// ── Event streaming infrastructure ──
// Stores the latest event per task so polling clients can retrieve it.
const latestEvents = new Map<string, AiTaskEvent>();
// Per-task subscriber callbacks for in-process event streaming.
const eventSubscribers = new Map<string, Set<(event: AiTaskEvent) => void>>();

/**
 * Emit a task event: store as latest and notify all subscribers.
 * Subscribers are notified asynchronously (microtask) so emitters don't
 * need to await them. Errors in subscribers are silently ignored.
 */
function emitEvent(taskId: string, event: AiTaskEvent): void {
  latestEvents.set(taskId, event);
  const subscribers = eventSubscribers.get(taskId);
  if (subscribers) {
    subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch {
        // Never let a subscriber error break the state machine.
      }
    });
  }
}

/**
 * Subscribe to events for a specific task.
 * The callback is invoked for every event emitted after subscription.
 */
export function onTaskEvent(
  taskId: string,
  callback: (event: AiTaskEvent) => void,
): void {
  let subscribers = eventSubscribers.get(taskId);
  if (!subscribers) {
    subscribers = new Set();
    eventSubscribers.set(taskId, subscribers);
  }
  subscribers.add(callback);
}

/**
 * Unsubscribe from events for a specific task.
 */
export function offTaskEvent(
  taskId: string,
  callback: (event: AiTaskEvent) => void,
): void {
  const subscribers = eventSubscribers.get(taskId);
  if (subscribers) {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      eventSubscribers.delete(taskId);
    }
  }
}

/**
 * Get the latest event emitted for a task, or undefined if none.
 * Used by the polling-style `aiTask/event` message handler.
 */
export function getLatestEvent(taskId: string): AiTaskEvent | undefined {
  return latestEvents.get(taskId);
}

/**
 * Start a new AI task.
 * Returns { accepted, taskId } — the task runs asynchronously.
 */
export async function startTask(
  request: AiTaskRequest,
  profile: ModelProfile,
): Promise<{ accepted: boolean; taskId: string }> {
  const policy = getTaskPolicy(request.type);

  const state: TaskState = {
    taskId: request.taskId,
    state: 'queued',
    progress: 0,
    intentId: request.intentId,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    abortController: new AbortController(),
  };

  activeTasks.set(request.taskId, state);

  await recordTaskStart({
    id: request.taskId,
    taskId: request.taskId,
    type: request.type,
    state: 'queued',
    modelProfileId: request.modelProfileId,
    promptVersion: policy.promptVersion,
    inputHash: request.idempotencyKey,
    startedAt: new Date().toISOString(),
  });

  // Emit 'queued' event so subscribers know the task has started.
  emitEvent(request.taskId, { type: 'queued', taskId: request.taskId });

  // Execute asynchronously (don't await — caller gets taskId immediately)
  executeTask(request, profile, state).catch((error) => {
    state.state = 'failed';
    state.error = mapTaskError(error);
    recordTaskTerminal(request.taskId, 'failed', state.error.code);
    emitEvent(request.taskId, {
      type: 'failed',
      taskId: request.taskId,
      error: state.error.userMessage,
    });
  });

  return { accepted: true, taskId: request.taskId };
}

/**
 * Execute a task: build prompt → call SDK → validate output → update state.
 */
async function executeTask(
  request: AiTaskRequest,
  profile: ModelProfile,
  state: TaskState,
): Promise<void> {
  const policy = getTaskPolicy(request.type);

  try {
    state.state = 'streaming';
    state.progress = 10;

    const model = createModel(profile);
    const prompt = buildPrompt(request.type, request.input);

    const { getOutputSchema } = await import('./schemas');
    const schema = getOutputSchema(request.type);
    if (!schema) {
      throw createError('INVALID_INPUT', `No schema for task type: ${request.type}`, false);
    }

    state.progress = 30;

    const { object } = await generateObject({
      model,
      schema,
      prompt,
      abortSignal: state.abortController?.signal,
      maxOutputTokens: policy.maxOutputTokens,
      temperature: policy.temperature,
    });

    // Stale-result suppression: re-read state after await (may have been cancelled)
    const currentState = activeTasks.get(request.taskId)?.state;
    if (currentState === 'cancelled' || currentState === 'superseded') {
      return;
    }

    state.state = 'validating';
    state.progress = 80;

    // Emit 'validating' event so the UI can show validation progress.
    emitEvent(request.taskId, { type: 'validating', taskId: request.taskId });

    const validation = validateResult(
      request.type,
      request.taskId,
      policy.promptVersion,
      object,
    );

    if (!validation.valid || !validation.result) {
      throw createError(
        (validation.errorCode as 'INVALID_INPUT') || 'INVALID_INPUT',
        validation.errorMessage || 'Model output validation failed',
        false,
      );
    }

    // Double-check after validation (another await point)
    const finalState = activeTasks.get(request.taskId)?.state;
    if (finalState === 'cancelled' || finalState === 'superseded') {
      return;
    }

    state.state = 'succeeded';
    state.progress = 100;
    state.result = validation.result;

    // Emit 'succeeded' event with the validated result.
    emitEvent(request.taskId, {
      type: 'succeeded',
      taskId: request.taskId,
      result: validation.result,
    });

    await recordTaskTerminal(request.taskId, 'succeeded');
  } catch (error) {
    if (state.state === 'cancelled' || state.state === 'superseded') {
      return;
    }

    const appError = mapTaskError(error);
    state.state = 'failed';
    state.error = appError;

    // Emit 'failed' event with the user-safe error message.
    emitEvent(request.taskId, {
      type: 'failed',
      taskId: request.taskId,
      error: appError.userMessage,
    });

    await recordTaskTerminal(request.taskId, 'failed', appError.code);
  }
}

/**
 * Cancel a running task.
 * Marks the task as cancelled and aborts the SDK call.
 * Late-arriving results are discarded (stale-result suppression).
 */
export async function cancelTask(
  taskId: string,
  _reason?: string,
): Promise<{ state: AiTaskState }> {
  const state = activeTasks.get(taskId);
  if (!state) {
    return { state: 'cancelled' };
  }

  state.state = 'cancelled';
  state.abortController?.abort();

  // Emit 'cancelled' event so subscribers are notified immediately.
  emitEvent(taskId, { type: 'cancelled', taskId });

  await recordTaskTerminal(taskId, 'cancelled');

  return { state: 'cancelled' };
}

/**
 * Get the current snapshot of a task for UI polling.
 */
export function getTaskSnapshot(taskId: string): {
  taskId: string;
  state: AiTaskState;
  progress?: number;
  result?: unknown;
  error?: string;
} | undefined {
  const state = activeTasks.get(taskId);
  if (!state) {
    return undefined;
  }

  return {
    taskId: state.taskId,
    state: state.state,
    progress: state.progress,
    result: state.result,
    error: state.error?.userMessage,
  };
}

/**
 * Find an active task's ID by its requestId.
 * Used by the selection/cancel handler to locate a task started from a
 * selection/explain request and cancel it. Returns undefined if no active
 * task matches the requestId.
 */
export function findTaskIdByRequestId(requestId: string): string | undefined {
  for (const [taskId, state] of activeTasks) {
    if (state.requestId === requestId) {
      return taskId;
    }
  }
  return undefined;
}

/**
 * Map an unknown error to a stable AppError.
 * Never exposes internal details, credentials, or raw response bodies.
 */
function mapTaskError(error: unknown): AppError {
  if (error && typeof error === 'object' && 'code' in error && 'userMessage' in error) {
    return error as unknown as AppError;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('abort') || message.includes('cancel')) {
      return createError('CANCELLED', 'Task was cancelled', false);
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return createError('TIMEOUT', 'Task timed out', true);
    }
    if (message.includes('401') || message.includes('auth')) {
      return createError('PERMISSION_DENIED', 'Authentication failed', false);
    }
    if (message.includes('404') || message.includes('not found')) {
      return createError('NOT_FOUND', 'Model not found', false);
    }
  }

  return createError('MODEL_UNAVAILABLE', 'Model service unavailable', true);
}

/**
 * On restart: clear the in-memory task map.
 * Persistent journal entries for in-flight tasks are marked INTERRUPTED
 * by the startup migration routine.
 */
export function markInterruptedTasks(): void {
  activeTasks.clear();
  latestEvents.clear();
  eventSubscribers.clear();
}
