import { generateText } from 'ai';
import { createLanguageModel, resolveModelProfile, mapModelError } from '@adapters/llm-provider';
import { renderPrompt, QUICK_EXPLAIN_PROMPT } from './prompts';
import { parseStructuredOutput, QuickExplainResultSchema } from './explanation-schema';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';
import { db } from '@infra/db/database';
import { nowIso } from '@shared/utils/date';

/**
 * AiTaskCoordinator — owns AI task lifecycle in the trusted background context.
 * Manages state, cancellation (AbortController), idempotency, and stale-result suppression.
 * See technical-design/05 §4 (AiTaskCoordinator).
 */

type TaskState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface TaskRecord {
  taskId: string;
  requestId: string;
  idempotencyKey: string;
  type: string;
  state: TaskState;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  abortController?: AbortController;
}

class AiTaskCoordinator {
  private tasks = new Map<string, TaskRecord>();

  /**
   * Start a quick-explain task. Returns immediately with taskId; result is available via getStatus.
   */
  async startQuickExplain(input: {
    taskId: string;
    requestId: string;
    idempotencyKey: string;
    selectedText: string;
    context?: string;
    pageTitle?: string;
  }): Promise<{ accepted: boolean; taskId: string }> {
    // Idempotency: if a task with the same key is running/succeeded, return existing
    const existing = Array.from(this.tasks.values()).find(
      (t) => t.idempotencyKey === input.idempotencyKey && (t.state === 'running' || t.state === 'succeeded'),
    );
    if (existing) {
      return { accepted: true, taskId: existing.taskId };
    }

    const record: TaskRecord = {
      taskId: input.taskId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      type: 'quick-explain',
      state: 'pending',
    };
    this.tasks.set(input.taskId, record);

    // Run async — don't await
    this.runQuickExplain(record, input).catch((err) => {
      record.state = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt = nowIso();
    });

    return { accepted: true, taskId: input.taskId };
  }

  private async runQuickExplain(
    record: TaskRecord,
    input: { selectedText: string; context?: string; pageTitle?: string },
  ): Promise<void> {
    record.state = 'running';
    record.startedAt = nowIso();
    record.abortController = new AbortController();

    // Record metadata in DB
    await db.modelRunMetadata.add({
      id: record.taskId,
      task: 'quick-explain',
      status: 'running',
      startedAt: record.startedAt,
    }).catch(() => { /* non-critical */ });

    try {
      const profile = await resolveModelProfile();
      const model = createLanguageModel(profile);

      const prompt = renderPrompt(QUICK_EXPLAIN_PROMPT, {
        selectedText: input.selectedText,
        context: input.context || 'No additional context available.',
        pageTitle: input.pageTitle || 'Unknown page',
      });

      const result = await generateText({
        model,
        prompt,
        temperature: 0.3,
        maxOutputTokens: 500,
        abortSignal: record.abortController.signal,
      });

      if (record.abortController.signal.aborted) {
        record.state = 'cancelled';
        record.completedAt = nowIso();
        return;
      }

      const parsed = parseStructuredOutput(QuickExplainResultSchema, result.text);
      if (!parsed.success || !parsed.data) {
        record.state = 'failed';
        record.error = parsed.error || 'Failed to parse model output';
        record.completedAt = nowIso();
        await this.updateMetadata(record, 'failed');
        return;
      }

      record.state = 'succeeded';
      record.result = parsed.data;
      record.completedAt = nowIso();
      await this.updateMetadata(record, 'succeeded');
    } catch (error) {
      if (record.abortController?.signal.aborted) {
        record.state = 'cancelled';
      } else {
        record.state = 'failed';
        const appError = mapModelError(error);
        record.error = appError.userMessage;
      }
      record.completedAt = nowIso();
      await this.updateMetadata(record, record.state === 'cancelled' ? 'cancelled' : 'failed');
    }
  }

  private async updateMetadata(record: TaskRecord, status: string): Promise<void> {
    await db.modelRunMetadata.update(record.taskId, {
      status: status as 'succeeded' | 'failed' | 'cancelled',
      completedAt: record.completedAt,
    }).catch(() => { /* non-critical */ });
  }

  /**
   * Get the current status of a task.
   */
  getStatus(taskId: string): {
    taskId: string;
    state: TaskState;
    progress?: number;
    result?: unknown;
    error?: string;
  } {
    const task = this.tasks.get(taskId);
    if (!task) {
      // Check DB for completed tasks
      return { taskId, state: 'failed', error: 'Task not found' };
    }
    return {
      taskId: task.taskId,
      state: task.state,
      result: task.result,
      error: task.error,
    };
  }

  /**
   * Cancel a running task.
   */
  cancel(taskId: string, reason?: string): { state: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { state: 'not_found' };
    }
    if (task.state === 'running' && task.abortController) {
      task.abortController.abort();
      task.state = 'cancelled';
      task.error = reason || 'Cancelled by user';
      task.completedAt = nowIso();
    }
    return { state: task.state };
  }
}

export const aiTaskCoordinator = new AiTaskCoordinator();
