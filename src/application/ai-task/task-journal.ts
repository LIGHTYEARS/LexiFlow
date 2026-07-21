import { db } from '@infra/db/database';
import type { AiTaskState, AiTaskType } from '@shared/protocol/protocol-map';

/**
 * TaskJournal — persists diagnostic metadata for AI tasks to Dexie.
 * NEVER stores credentials, baseURL, full response body, or model output text.
 * Only stores: taskId, type, state, timestamps, model alias, prompt version,
 * error code, and content hash.
 * See technical-design/05 §4 (TaskJournal) and §8 (idempotency & transactions).
 */

export interface TaskJournalEntry {
  id: string;
  taskId: string;
  type: AiTaskType;
  state: AiTaskState;
  modelProfileId: string;
  promptVersion: string;
  inputHash: string;
  startedAt: string;
}

/**
 * Record a task start event in the journal.
 */
export async function recordTaskStart(entry: TaskJournalEntry): Promise<void> {
  await db.modelRunMetadata.add({
    id: entry.id,
    task: entry.type,
    status: 'running',
    modelId: entry.modelProfileId,
    promptVersion: entry.promptVersion,
    startedAt: entry.startedAt,
  });
}

/**
 * Record a task terminal state in the journal.
 * Only called for validated terminal states (succeeded, failed, cancelled).
 */
export async function recordTaskTerminal(
  taskId: string,
  state: AiTaskState,
  errorCode?: string,
): Promise<void> {
  const existing = await db.modelRunMetadata.get(taskId);
  if (existing) {
    const mappedStatus = mapStateToStatus(state);
    await db.modelRunMetadata.update(taskId, {
      status: mappedStatus,
      completedAt: new Date().toISOString(),
      errorCode,
    });
  }
}

function mapStateToStatus(state: AiTaskState): 'running' | 'succeeded' | 'failed' | 'cancelled' {
  switch (state) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'superseded': return 'cancelled';
    default: return 'running';
  }
}
