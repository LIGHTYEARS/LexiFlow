import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import { aiTaskCoordinator } from '@adapters/ai/ai-task-coordinator';
import { testConnection } from '@adapters/ai/llm-gateway';
import type { AiResultTaskType } from '@adapters/ai/ai-result-schemas';
import type {
  AiTaskSnapshot,
  ConnectionTestResult,
} from '@shared/protocol/protocol-map';

/**
 * Register AI task handlers (technical-design/05 §5).
 * These run only in the background trusted context — the only place that may
 * read the credential and call the AI SDK.
 *
 * Only extension pages may start AI tasks directly; content-script explanation
 * flows go through `selection/explain` (see capture-handlers), which is where
 * page-origin authorization is enforced.
 */

const AI_TASK_TYPES = ['quick-explain', 'full-analysis', 'practice-generate'] as const;

const AiTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  requestId: z.string(),
  idempotencyKey: z.string(),
  intentId: z.string(),
  type: z.enum(AI_TASK_TYPES),
  input: z.object({
    selectedText: z.string().min(1),
    context: z.string().optional(),
    pageTitle: z.string().optional(),
  }),
  modelProfileId: z.string(),
  promptVersion: z.string(),
});

export function registerAiTaskHandlers(): void {
  // ── Start a task and await its terminal snapshot ──
  messageRegistry.register<unknown, { accepted: boolean; taskId: string; snapshot: AiTaskSnapshot }>(
    'aiTask/start',
    async (payload, envelope) => {
      const parsed = parsePayload(AiTaskRequestSchema, payload, envelope);
      if (!parsed.ok) return parsed.result;
      const req = parsed.value;

      const { accepted, taskId } = aiTaskCoordinator.start({
        taskId: req.taskId,
        requestId: req.requestId,
        idempotencyKey: req.idempotencyKey,
        type: req.type as AiResultTaskType,
        input: req.input,
      });
      // Await the terminal snapshot so the caller gets the validated result in
      // one round-trip (the popover needs the result, not just acceptance).
      const snapshot = await aiTaskCoordinator.await(taskId);
      return ok(envelope.requestId, { accepted, taskId, snapshot });
    },
  );

  // ── Cancel ──
  messageRegistry.register<unknown, { state: string }>(
    'aiTask/cancel',
    (payload, envelope) => {
      const parsed = parsePayload(
        z.object({ taskId: z.string(), reason: z.string().optional() }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      return ok(envelope.requestId, aiTaskCoordinator.cancel(parsed.value.taskId));
    },
  );

  // ── Status ──
  messageRegistry.register<unknown, AiTaskSnapshot>(
    'aiTask/getStatus',
    (payload, envelope) => {
      const parsed = parsePayload(z.object({ taskId: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      return ok(envelope.requestId, aiTaskCoordinator.getStatus(parsed.value.taskId));
    },
  );

  // ── Connection test (trusted contexts only, never content scripts) ──
  messageRegistry.register<unknown, ConnectionTestResult>(
    'aiTask/testConnection',
    async (payload, envelope, sender) => {
      if (sender.tab && sender.url?.startsWith('http')) {
        return fail(
          envelope.requestId,
          createError('PERMISSION_DENIED', 'Connection test not available to content scripts', false),
        );
      }
      const result = await testConnection();
      return ok(envelope.requestId, result);
    },
  );
}
