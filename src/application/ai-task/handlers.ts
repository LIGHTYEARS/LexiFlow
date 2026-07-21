import { messageRegistry } from '@infra/messaging/message-registry';
import { getSettings, getCredentialValue } from '@infra/storage/settings-gateway';
import { canMakeModelRequest } from '@infra/permissions/model-origin-gateway';
import { startTask, cancelTask, getTaskSnapshot, getLatestEvent } from './coordinator';
import { testConnection as testModelConnection } from '@adapters/litellm/provider-factory';
import type {
  AiTaskRequest,
  AiTaskSnapshot,
  AiTaskEvent,
  ConnectionTestResult,
} from '@shared/protocol/protocol-map';
import { ok, fail, createError } from '@shared/protocol/envelope';

/**
 * AI Task handlers — route aiTask.* and selection/explain messages.
 * See technical-design/05 §5 (contracts) and §6 (state machine).
 */

/**
 * Resolve a model profile ID to a ModelProfile (with baseURL and apiKey).
 * The modelProfileId maps to the taskModels record in settings.
 * The baseURL comes from settings.model.baseUrl.
 * The apiKey comes from the encrypted credential store.
 */
async function resolveModelProfile(
  modelProfileId: string,
): Promise<{
  modelId: string;
  baseUrl: string;
  apiKey: string;
} | null> {
  const settings = await getSettings();

  // Resolve model ID from the taskModels record
  const modelId = settings.model.taskModels[modelProfileId] || modelProfileId;

  // Get baseURL
  const baseUrl = settings.model.baseUrl;
  if (!baseUrl) {
    return null;
  }

  // Get API key from credential store
  const credentialRef = settings.model.credentialRef;
  if (!credentialRef) {
    return null;
  }
  const apiKey = await getCredentialValue(credentialRef);
  if (!apiKey) {
    return null;
  }

  return { modelId, baseUrl, apiKey };
}

/**
 * Register all AI task handlers.
 */
export function registerAiTaskHandlers(): void {
  // ── aiTask/start ──
  messageRegistry.register<AiTaskRequest, { accepted: boolean; taskId: string }>(
    'aiTask/start',
    async (payload, envelope, sender) => {
      const request = payload as AiTaskRequest;

      // Resolve model profile
      const profile = await resolveModelProfile(request.modelProfileId);
      if (!profile) {
        return fail(
          envelope.requestId,
          createError('PERMISSION_DENIED', 'Model service not configured', false),
        );
      }

      // Verify permission for the model origin
      const access = await canMakeModelRequest(profile.baseUrl);
      if (!access.allowed) {
        return fail(envelope.requestId, access.error || createError('PERMISSION_DENIED', 'Model origin not authorized', false));
      }

      // Start the task
      const result = await startTask(request, {
        id: request.modelProfileId,
        modelId: profile.modelId,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
      });

      return ok(envelope.requestId, result);
    },
  );

  // ── aiTask/cancel ──
  messageRegistry.register<{ taskId: string; reason?: string }, { state: string }>(
    'aiTask/cancel',
    async (payload, envelope) => {
      const input = payload as { taskId: string; reason?: string };
      const result = await cancelTask(input.taskId, input.reason);
      return ok(envelope.requestId, result);
    },
  );

  // ── aiTask/getStatus ──
  messageRegistry.register<{ taskId: string }, AiTaskSnapshot | null>(
    'aiTask/getStatus',
    async (payload, envelope) => {
      const input = payload as { taskId: string };
      const snapshot = getTaskSnapshot(input.taskId);
      return ok(envelope.requestId, snapshot || null);
    },
  );

  // ── aiTask/event ──
  // Polling-style endpoint that returns the latest event emitted for a task.
  // Since @webext-core/messaging is request-response (no server push), the UI
  // polls this endpoint every ~300ms to get real-time progress updates.
  // Returns null if no event has been emitted yet (e.g. task not found).
  messageRegistry.register<{ taskId: string }, AiTaskEvent | null>(
    'aiTask/event',
    async (payload, envelope) => {
      const input = payload as { taskId: string };
      const event = getLatestEvent(input.taskId);
      return ok(envelope.requestId, event || null);
    },
  );

  // ── aiTask/testConnection ──
  messageRegistry.register<{ profileId: string }, ConnectionTestResult>(
    'aiTask/testConnection',
    async (payload, envelope) => {
      const input = payload as { profileId: string };

      const profile = await resolveModelProfile(input.profileId);
      if (!profile) {
        return ok(envelope.requestId, {
          ok: false,
          code: 'PERMISSION_DENIED',
          message: 'Model service not configured',
        });
      }

      // Verify permission
      const access = await canMakeModelRequest(profile.baseUrl);
      if (!access.allowed) {
        return ok(envelope.requestId, {
          ok: false,
          code: 'PERMISSION_DENIED',
          message: 'Model origin not authorized',
        });
      }

      // Test the connection
      const result = await testModelConnection({
        id: input.profileId,
        modelId: profile.modelId,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
      });

      return ok(envelope.requestId, result);
    },
  );

  // ── selection/explain ──
  // Bridges M3 selection trigger to M4 AI task execution.
  // Creates a quick-explain task from the selection + context.
  messageRegistry.register<
    { requestId: string; selection: string; context?: string; source: { origin: string; urlWithoutFragment: string }; task: string },
    { accepted: boolean; taskId: string }
  >('selection/explain', async (payload, envelope) => {
    const input = payload as {
      requestId: string;
      selection: string;
      context?: string;
      source: { origin: string; urlWithoutFragment: string };
      task: string;
    };

    // Resolve model profile (use default)
    const profile = await resolveModelProfile('default');
    if (!profile) {
      return fail(
        envelope.requestId,
        createError('PERMISSION_DENIED', 'Model service not configured', false),
      );
    }

    // Verify permission
    const access = await canMakeModelRequest(profile.baseUrl);
    if (!access.allowed) {
      return fail(envelope.requestId, access.error || createError('PERMISSION_DENIED', 'Model origin not authorized', false));
    }

    // Create a quick-explain task
    const taskId = crypto.randomUUID();
    const taskRequest: AiTaskRequest = {
      taskId,
      requestId: input.requestId,
      idempotencyKey: crypto.randomUUID(),
      intentId: input.requestId,
      type: 'quick-explain',
      input: {
        selectedText: input.selection,
        context: input.context,
      },
      modelProfileId: 'default',
      promptVersion: 'quick-explain-v1',
    };

    const result = await startTask(taskRequest, {
      id: 'default',
      modelId: profile.modelId,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
    });

    return ok(envelope.requestId, result);
  });
}
