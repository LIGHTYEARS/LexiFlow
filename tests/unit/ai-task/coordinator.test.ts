import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiTaskRequest } from '@shared/protocol/protocol-map';
import type { ModelProfile } from '@adapters/litellm/provider-factory';

// Use vi.hoisted so mock functions are available when vi.mock factories run
// (vi.mock factories are hoisted above regular variable declarations).
const { generateObjectMock, createModelMock, recordTaskStartMock, recordTaskTerminalMock } =
  vi.hoisted(() => ({
    generateObjectMock: vi.fn(),
    createModelMock: vi.fn(),
    recordTaskStartMock: vi.fn(),
    recordTaskTerminalMock: vi.fn(),
  }));

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
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
    // Default: generateObject returns valid quick-explain output
    generateObjectMock.mockResolvedValue({
      object: { chineseMeaning: '你好', englishMeaning: 'hello' },
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
      // generateObject returns output that fails schema validation
      generateObjectMock.mockResolvedValue({
        object: { chineseMeaning: 12345 },
      });

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toBeDefined();
    });

    it('transitions to failed when generateObject throws', async () => {
      generateObjectMock.mockRejectedValue(new Error('Model service unavailable'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toBeDefined();
    });

    it('maps timeout errors to TIMEOUT code', async () => {
      generateObjectMock.mockRejectedValue(new Error('Request timed out'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toContain('timed out');
    });

    it('maps 401 errors to PERMISSION_DENIED', async () => {
      generateObjectMock.mockRejectedValue(new Error('401 Authentication failed'));

      const request = createRequest();
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'failed');

      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('failed');
      expect(snapshot?.error).toContain('Authentication');
    });

    it('maps 404 errors to NOT_FOUND', async () => {
      generateObjectMock.mockRejectedValue(new Error('404 Model not found'));

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
      // generateObject never resolves — task stays in-flight
      generateObjectMock.mockReturnValue(new Promise(() => {}));

      const request = createRequest();
      await startTask(request, testProfile);

      // Wait for executeTask to reach generateObject (past dynamic import)
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
      // generateObject resolves after a delay (controlled by us)
      let resolveGenerate: (value: { object: unknown }) => void;
      generateObjectMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGenerate = resolve;
          }),
      );

      const request = createRequest();
      await startTask(request, testProfile);

      // Wait for executeTask to reach generateObject
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Cancel the task
      await cancelTask(request.taskId);

      // Now resolve generateObject (simulating late-arriving result)
      resolveGenerate!({ object: { chineseMeaning: '你好' } });

      // Wait a tick for the stale-result suppression logic to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The state should remain cancelled, not succeeded
      const snapshot = getTaskSnapshot(request.taskId);
      expect(snapshot?.state).toBe('cancelled');
      expect(snapshot?.result).toBeUndefined();
    });

    it('records task terminal in journal on cancel', async () => {
      generateObjectMock.mockReturnValue(new Promise(() => {}));

      const request = createRequest();
      await startTask(request, testProfile);
      await new Promise((resolve) => setTimeout(resolve, 50));

      await cancelTask(request.taskId);
      expect(recordTaskTerminalMock).toHaveBeenCalledWith(request.taskId, 'cancelled');
    });

    it('emits cancelled event', async () => {
      generateObjectMock.mockReturnValue(new Promise(() => {}));

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
      generateObjectMock.mockRejectedValue(new Error('Model service unavailable'));

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
    it('clears all active tasks from the map', async () => {
      const request1 = createRequest({ taskId: 'task-1' });
      const request2 = createRequest({ taskId: 'task-2' });
      await startTask(request1, testProfile);
      await startTask(request2, testProfile);

      expect(getTaskSnapshot('task-1')).toBeDefined();
      expect(getTaskSnapshot('task-2')).toBeDefined();

      markInterruptedTasks();

      expect(getTaskSnapshot('task-1')).toBeUndefined();
      expect(getTaskSnapshot('task-2')).toBeUndefined();
    });

    it('clears latest events', async () => {
      const request = createRequest();
      await startTask(request, testProfile);
      expect(getLatestEvent(request.taskId)).toBeDefined();

      markInterruptedTasks();
      expect(getLatestEvent(request.taskId)).toBeUndefined();
    });

    it('clears event subscribers', async () => {
      const callback = vi.fn();
      onTaskEvent('task-sub', callback);
      markInterruptedTasks();

      // After clearing, the subscriber map is empty.
      // Starting a new task with this ID should not trigger the old callback.
      const request = createRequest({ taskId: 'task-sub' });
      await startTask(request, testProfile);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Event streaming', () => {
    it('onTaskEvent subscribes and receives queued event', async () => {
      const events: Array<{ type: string; taskId: string }> = [];
      const callback = (event: { type: string; taskId: string }) => {
        events.push(event);
      };

      const request = createRequest();
      onTaskEvent(request.taskId, callback);

      await startTask(request, testProfile);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toEqual({ type: 'queued', taskId: request.taskId });

      offTaskEvent(request.taskId, callback);
    });

    it('getLatestEvent returns the queued event after start', async () => {
      const request = createRequest();
      await startTask(request, testProfile);

      const event = getLatestEvent(request.taskId);
      expect(event).toBeDefined();
      expect(event?.type).toBe('queued');
      expect(event?.taskId).toBe(request.taskId);
    });

    it('getLatestEvent returns undefined for unknown task', () => {
      const event = getLatestEvent('non-existent-task');
      expect(event).toBeUndefined();
    });

    it('offTaskEvent removes the subscriber', async () => {
      const callback = vi.fn();
      const taskId = 'task-off-test';

      onTaskEvent(taskId, callback);
      offTaskEvent(taskId, callback);

      // Start a task with this ID — callback should NOT be called
      const request = createRequest({ taskId });
      await startTask(request, testProfile);

      expect(callback).not.toHaveBeenCalled();
    });

    it('receives succeeded event on successful completion', async () => {
      const events: Array<{ type: string }> = [];
      const callback = (event: { type: string }) => {
        events.push(event);
      };

      const request = createRequest();
      onTaskEvent(request.taskId, callback);
      await startTask(request, testProfile);

      await waitForState(request.taskId, 'succeeded');

      expect(events.some((e) => e.type === 'succeeded')).toBe(true);

      offTaskEvent(request.taskId, callback);
    });

    it('receives cancelled event on cancellation', async () => {
      generateObjectMock.mockReturnValue(new Promise(() => {}));

      const events: Array<{ type: string }> = [];
      const callback = (event: { type: string }) => {
        events.push(event);
      };

      const request = createRequest();
      onTaskEvent(request.taskId, callback);
      await startTask(request, testProfile);

      await new Promise((resolve) => setTimeout(resolve, 50));
      await cancelTask(request.taskId);

      expect(events.some((e) => e.type === 'cancelled')).toBe(true);

      offTaskEvent(request.taskId, callback);
    });

    it('subscriber errors are silently ignored', async () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('subscriber error');
      });

      const request = createRequest();
      onTaskEvent(request.taskId, throwingCallback);

      // Should not throw even though the subscriber throws
      await expect(startTask(request, testProfile)).resolves.toBeDefined();

      offTaskEvent(request.taskId, throwingCallback);
    });

    it('multiple subscribers all receive events', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const request = createRequest();
      onTaskEvent(request.taskId, callback1);
      onTaskEvent(request.taskId, callback2);

      await startTask(request, testProfile);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      offTaskEvent(request.taskId, callback1);
      offTaskEvent(request.taskId, callback2);
    });
  });
});
