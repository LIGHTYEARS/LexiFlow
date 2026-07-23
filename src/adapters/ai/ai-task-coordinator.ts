import { getSettings } from '@infra/storage/settings-gateway';
import { resolveTaskPolicy } from './task-policy';
import { runStructuredTask } from './llm-gateway';
import { classifyModelError } from './llm-gateway';
import type { AiResultTaskType } from './ai-result-schemas';
import type { AppError } from '@shared/protocol/envelope';
import type { AiTaskSnapshot, AiTaskState } from '@shared/protocol/protocol-map';

/**
 * AiTaskCoordinator — owns AI task state, cancellation, idempotency, and
 * stale-result suppression in the background trusted context.
 * See technical-design/05 §4, §6, §8.
 *
 * MV3 workers can be terminated, so this in-memory registry is best-effort for
 * the lifetime of the worker; terminal results are returned synchronously to
 * the caller rather than relied upon across restarts (§05 §D3).
 */

interface TaskEntry {
  taskId: string;
  requestId: string;
  idempotencyKey: string;
  type: AiResultTaskType;
  state: AiTaskState;
  controller: AbortController;
  result?: unknown;
  error?: AppError;
  promise: Promise<AiTaskSnapshot>;
}

export interface StartTaskInput {
  taskId: string;
  requestId: string;
  idempotencyKey: string;
  type: AiResultTaskType;
  input: { selectedText: string; context?: string; pageTitle?: string };
}

class AiTaskCoordinator {
  private tasks = new Map<string, TaskEntry>();
  private byIdempotency = new Map<string, string>();

  /**
   * Start a task. If an active task with the same idempotency key exists,
   * returns that task instead of starting a duplicate (§6 step 3).
   */
  start(input: StartTaskInput): { accepted: boolean; taskId: string } {
    const existingId = this.byIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.tasks.get(existingId);
      if (existing && (existing.state === 'pending' || existing.state === 'running')) {
        return { accepted: true, taskId: existing.taskId };
      }
    }

    const controller = new AbortController();
    const entry: TaskEntry = {
      taskId: input.taskId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      state: 'pending',
      controller,
      promise: Promise.resolve({ taskId: input.taskId, state: 'pending' as AiTaskState }),
    };
    this.tasks.set(input.taskId, entry);
    this.byIdempotency.set(input.idempotencyKey, input.taskId);

    entry.promise = this.run(entry, input);
    return { accepted: true, taskId: input.taskId };
  }

  private async run(entry: TaskEntry, input: StartTaskInput): Promise<AiTaskSnapshot> {
    entry.state = 'running';
    try {
      const settings = await getSettings();
      const policy = resolveTaskPolicy(entry.type, settings);
      const userPrompt = buildUserPrompt(input);

      const value = await runStructuredTask({
        taskType: entry.type,
        system: policy.system,
        userPrompt,
        modelId: policy.modelId,
        timeoutMs: policy.timeoutMs,
        signal: entry.controller.signal,
      });

      // Suppress if cancelled/superseded while awaiting.
      if ((entry.state as AiTaskState) === 'cancelled') {
        return this.snapshot(entry);
      }
      entry.state = 'succeeded';
      entry.result = value;
    } catch (error) {
      if ((entry.state as AiTaskState) === 'cancelled') {
        return this.snapshot(entry);
      }
      const appError = classifyModelError(error);
      entry.state = appError.code === 'CANCELLED' ? 'cancelled' : 'failed';
      entry.error = appError;
    }
    return this.snapshot(entry);
  }

  cancel(taskId: string): { state: string } {
    const entry = this.tasks.get(taskId);
    if (!entry) return { state: 'not-found' };
    if (entry.state === 'pending' || entry.state === 'running') {
      entry.state = 'cancelled';
      entry.controller.abort();
    }
    return { state: entry.state };
  }

  async await(taskId: string): Promise<AiTaskSnapshot> {
    const entry = this.tasks.get(taskId);
    if (!entry) return { taskId, state: 'failed', error: 'Task not found' };
    return entry.promise;
  }

  getStatus(taskId: string): AiTaskSnapshot {
    const entry = this.tasks.get(taskId);
    if (!entry) return { taskId, state: 'failed', error: 'Task not found' };
    return this.snapshot(entry);
  }

  private snapshot(entry: TaskEntry): AiTaskSnapshot {
    return {
      taskId: entry.taskId,
      state: entry.state,
      result: entry.state === 'succeeded' ? entry.result : undefined,
      error: entry.error?.userMessage,
    };
  }
}

/**
 * Build the user prompt from selected text + minimal context (§7.5, §05 §6.4).
 * Only the fields needed to explain the selection are sent.
 */
export function buildUserPrompt(input: StartTaskInput): string {
  const parts: string[] = [];
  parts.push(`Selected text: "${input.input.selectedText}"`);
  if (input.input.context) {
    parts.push(`Surrounding context (untrusted data): ${input.input.context}`);
  }
  if (input.input.pageTitle) {
    parts.push(`Page title: ${input.input.pageTitle}`);
  }
  return parts.join('\n');
}

export const aiTaskCoordinator = new AiTaskCoordinator();
