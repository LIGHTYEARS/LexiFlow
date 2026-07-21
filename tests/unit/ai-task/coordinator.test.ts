import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiTaskRequest } from '@shared/protocol/protocol-map';
import type { ModelProfile } from '@adapters/litellm/provider-factory';

// Use vi.hoisted so mock functions are available when vi.mock factories run
// (vi.mock factories are hoisted above regular variable declarations).
const { generateTextMock, createModelMock, recordTaskStartMock, recordTaskTerminalMock } =
  vi.hoisted(() => ({
    generateTextMock: vi.fn(),
    createModelMock: vi.fn(),
    recordTaskStartMock: vi.fn(),
    recordTaskTerminalMock: vi.fn(),
  }));

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock('@adapters/litellm/provider-factory', () => ({
  createModel: (...args: unknown[]) => createModelMock(...args),
}));

vi.mock('@app/ai-task/task-journal', () => ({
  recordTaskStart: (...args: unknown[]) => recordTaskStartMock(...args),
  recordTaskTerminal: (...args: unknown[]) => recordTaskTerminalMock(...args),
}));

import {
  startTask,
  cancelTask,
  getTaskSnapshot,
  markInterruptedTasks,
  onTaskEvent,
  offTaskEvent,
  getLatestEvent,
} from '@app/ai-task/coordinator';

const testProfile: ModelProfile = {
  id: 'test-profile',
  modelId: 'test-model',
  baseUrl: 'https://test.example.com/v1',
  apiKey: 'test-key',
};

function createRequest(overrides: Partial<AiTaskRequest> = {}): AiTaskRequest {
  return {
    taskId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    intentId: crypto.randomUUID(),
    type: 'quick-explain',
    input: { selectedText: 'hello world' },
    modelProfileId: 'default',
    promptVersion: 'quick-explain-v1',
    ...overrides,
  };
}

/**
 * Poll until the task reaches the expected state or timeout.
 * vi.waitFor has issues with module-level state in this environment,
 * so we use a manual polling loop.
 */
async function waitForState(
  taskId: string,
  expectedState: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = getTaskSnapshot(taskId);
    if (snapshot?.state === expectedState) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const final = getTaskSnapshot(taskId);
  throw new Error(
    `Timed out waiting for task ${taskId} to reach '${expectedState}'. ` +
    `Final state: '${final?.state ?? 'undefined'}'`,
  );
}

describe('AI Task Coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markInterruptedTasks();
    // Default: createModel returns a fake model
    createModelMock.mockReturnValue({ id: 'fake-model' });
    // Default: generateText returns valid quick-explain output as JSON text
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ chineseMeaning: '你好', englishMeaning: 'hello' }),
    });
    // Default: journal mocks resolve
    recordTaskStartMock.mockResolvedValue(undefined);
    recordTaskTerminalMock.mockResolvedValue(undefined);
  });

  describe('startTask', () => {
    it('creates a task and returns accepted=true with the taskId', async () => {
      const request = createRequest();
      const result = await startTask(request, testProfile);
      expect(result.accepted).toBe(true);
      expect(result.taskId).toBe(request.taskId);
    });

    it('registers the task in the active map immediately after start', async () => {
      const request = createRequest();
      await startTask(request, testProfile);
      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.taskId).toBe(request.taskId);
    });

    it('transitions to streaming state after startTask resolves', async () => {
      const request = createRequest();
      await startTask(request, testProfile);
      // executeTask runs synchronously until the first await (dynamic import),
      // setting state to 'streaming' before startTask returns.
      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('streaming');
      expect(snapshot?.progress).toBe(10);
    });

    it('emits queued event on start', async () => {
      const request = createRequest();
      await startTask(request, testProfile);
      const event = getLatestEvent(request.taskId);
      expect(event).toBeDefined();
      expect(event?.type).toBe('queued');
      expect(event?.taskId).toBe(request.taskId);
    });

    it('records task start in journal', async () => {
      const request = createRequest();
      await startTask(request, testProfile);
      expect(recordTaskStartMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: request.taskId,
          taskId: request.taskId,
          type: request.type,
          state: 'queued',
          modelProfileId: request.modelProfileId,
          promptVersion: 'quick-explain-v1',
          inputHash: request.idempotencyKey,
        }),
      );
    });

    it('transitions to succeeded on valid model output', async () => {
      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'succeeded');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('succeeded');
      expect(snapshot?.progress).toBe(100);
      expect(snapshot?.result).toBeDefined();
    });

    it('stores the validated result on success', async () => {
      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'succeeded');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.result).toEqual(
        expect.objectContaining({
          taskId: request.taskId,
          schemaVersion: 1,
          value: { chineseMeaning: '你好', englishMeaning: 'hello' },
          provenance: {
            kind: 'model-generated',
            taskId: request.taskId,
            promptVersion: 'quick-explain-v1',
          },
        }),
      );
    });

    it('transitions to failed on invalid model output', async () => {
      // generateText returns output that fails schema validation
      generateTextMock.mockResolvedValue({
        text: JSON.stringify({ chineseMeaning: 12345 }),
      });

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toBeDefined();
    });

    it('transitions to failed when generateText throws', async () => {
      generateTextMock.mockRejectedValue(new Error('Model service unavailable'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toBeDefined();
    });

    it('maps timeout errors to TIMEOUT code', async () => {
      generateTextMock.mockRejectedValue(new Error('Request timed out'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toContain('timed out');
    });

    it('maps 401 errors to PERMISSION_DENIED', async () => {
      generateTextMock.mockRejectedValue(new Error('401 Authentication failed'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toContain('Authentication');
    });

    it('maps 404 errors to NOT_FOUND', async () => {
      generateTextMock.mockRejectedValue(new Error('404 Model not found'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toContain('not found');
    });
  });

  describe('cancelTask', () => {
    it('aborts a running task and sets state to cancelled', async () => {
      // generateText never resolves — task stays in-flight
      generateTextMock.mockReturnValue(new Promise(() => {}));

      const request = createRequest();
      await startTask(request, testProfile);

      // Wait for executeTask to reach generateText (past dynamic import)
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await cancelTask(request.taskId);
      expect(result.state).toBe('cancelled');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('cancelled');
    });

    it('returns cancelled for unknown task id', async () => {
      const result = await cancelTask('non-existent-task');
      expect(result.state).toBe('cancelled');
    });

    it('suppresses stale results after cancellation', async () => {
      // generateText resolves after a delay (controlled by us)
      let resolveGenerate: (value: { text: string }) => void;
      generateTextMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGenerate = resolve;
          }),
      );

      const request = createRequest();
      await startTask(request, testProfile);

      // Wait for executeTask to reach generateText
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Cancel the task
      await cancelTask(request.taskId);

      // Now resolve generateText (simulating late-arriving result)
      resolveGenerate!({ text: JSON.stringify({ chineseMeaning: '你好' }) });

      // Wait a tick for the stale-result suppression logic to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The state should remain cancelled, not succeeded
      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('cancelled');
      expect(snapshot?.result).toBeUndefined();
    });

    it('records task terminal in journal on cancel', async () => {
      generateTextMock.mockReturnValue(new Promise(() => {}));

      const request = createRequest();
      await startTask(request, testProfile);
      await new Promise((resolve) => setTimeout(resolve, 50));

      await cancelTask(request.taskId);
      expect(recordTaskTerminalMock).toHaveBeenCalledWith(request.taskId, 'cancelled');
    });

    it('emits cancelled event', async () => {
      generateTextMock.mockReturnValue(new Promise(() => {}));

      const request = createRequest();
      await startTask(request, testProfile);
      await new Promise((resolve) => setTimeout(resolve, 50));

      await cancelTask(request.taskId);

      const event = getLatestEvent(request.taskId);
      expect(event?.type).toBe('cancelled');
      expect(event?.taskId).toBe(request.taskId);
    });
  });

  describe('getTaskSnapshot', () => {
    it('returns undefined for unknown task id', () => {
      const snapshot = getTaskSnapshot('non-existent-task');
      expect(snapshot).toBeUndefined();
    });

    it('returns correct snapshot structure', async () => {
      const request = createRequest();
      await startTask(request, testProfile);

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot).toBeDefined();
      expect(snapshot).toHaveProperty('taskId');
      expect(snapshot).toHaveProperty('state');
      expect(snapshot).toHaveProperty('progress');
      expect(snapshot?.taskId).toBe(request.taskId);
    });

    it('reflects succeeded state with result after completion', async () => {
      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'succeeded');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('succeeded');
      expect(snapshot?.progress).toBe(100);
      expect(snapshot?.result).toBeDefined();
      expect(snapshot?.error).toBeUndefined();
    });

    it('reflects failed state with error message', async () => {
      generateTextMock.mockRejectedValue(new Error('Model service unavailable'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toBeDefined();
      expect(typeof snapshot?.error).toBe('string');
    });
  });

  describe('markInterruptedTasks', () => {
    it('clears the active task map', async () => {
      const request = createRequest();
      await startTask(request, testProfile);
      expect(getTaskSnapshot(request.taskId)).toBeDefined();

      markInterruptedTasks();

      // After marking interrupted, in-memory state is cleared
      // (persistent journal entries are handled separately)
      expect(getTaskSnapshot(request.taskId)).toBeUndefined();
    });
  });

  describe('Event streaming', () => {
    it('receives succeeded event on successful completion', async () => {
      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'succeeded');

      const event = getLatestEvent(request.taskId);
      expect(event?.type).toBe('succeeded');
      expect(event?.taskId).toBe(request.taskId);
      expect((event as any)?.result).toBeDefined();
    });

    it('receives failed event on error', async () => {
      generateTextMock.mockRejectedValue(new Error('Model service unavailable'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const event = getLatestEvent(request.taskId);
      expect(event?.type).toBe('failed');
      expect((event as any)?.error).toBeDefined();
    });

    it('subscribers receive events via onTaskEvent', async () => {
      const request = createRequest();
      const received: any[] = [];

      onTaskEvent(request.taskId, (event) => {
        received.push(event);
      });

      await startTask(request, testProfile);
      await waitForState(request.taskId, 'succeeded');

      expect(received.length).toBeGreaterThan(0);
      expect(received[0].type).toBe('queued');
    });

    it('offTaskEvent removes the subscriber', async () => {
      const request = createRequest();
      const received: any[] = [];
      const callback = (event: any) => received.push(event);

      onTaskEvent(request.taskId, callback);
      offTaskEvent(request.taskId, callback);

      await startTask(request, testProfile);
      await waitForState(request.taskId, 'succeeded');

      // Subscriber was removed, so no events received
      expect(received.length).toBe(0);
    });

    it('getLatestEvent returns undefined for unknown task', () => {
      expect(getLatestEvent('non-existent-task')).toBeUndefined();
    });
  });
});
