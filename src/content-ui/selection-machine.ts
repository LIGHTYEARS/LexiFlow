import { createMachine, assign } from 'xstate';
import type { SelectionSnapshot } from './selection-validator';
import type { ContextEvidence } from './context-extractor';

/**
 * Selection UI state machine.
 * See technical-design/03 §6 for the state diagram.
 *
 * States:
 * - idle: no valid selection
 * - stabilizing: selection detected, waiting to stabilize
 * - armed: selection stabilized, trigger button shown (NO network request)
 * - extracting: user triggered, extracting context
 * - explaining: waiting for model response
 * - result: explanation shown
 * - failure: explanation failed
 * - cancelled: user cancelled
 */

export type SelectionUiContext = {
  snapshot: SelectionSnapshot | null;
  context: ContextEvidence | null;
  requestId: string | null;
  error: string | null;
  revision: number;
};

export type SelectionUiEvent =
  | { type: 'VALID_SELECTION'; snapshot: SelectionSnapshot }
  | { type: 'SELECTION_CHANGED' }
  | { type: 'SELECTION_COLLAPSED' }
  | { type: 'EXPLICIT_TRIGGER' }
  | { type: 'AUTO_TRIGGER' }
  | { type: 'CONTEXT_READY'; context: ContextEvidence }
  | { type: 'EXPLAIN_PROGRESS' }
  | { type: 'EXPLAIN_SUCCEEDED' }
  | { type: 'EXPLAIN_FAILED'; error: string }
  | { type: 'CANCEL' }
  | { type: 'DISMISS' }
  | { type: 'ESC' }
  | { type: 'RETRY' }
  | { type: 'SAVE' }
  | { type: 'EXPAND' };

export const selectionMachine = createMachine({
  id: 'selectionUi',
  initial: 'idle',
  /**
   * Initial context.
   *
   * The `as` assertions below are required by XState v5's type inference.
   * When a context field is initialised to `null`, the inferred literal type
   * (`null`) would otherwise collapse the context type so that subsequent
   * `assign` actions and state readers see only `null`. Asserting the full
   * union type (e.g. `SelectionSnapshot | null`) ensures the machine's
   * context is correctly typed throughout.
   */
  context: {
    snapshot: null as SelectionSnapshot | null,
    context: null as ContextEvidence | null,
    requestId: null as string | null,
    error: null as string | null,
    revision: 0,
  },
  states: {
    idle: {
      on: {
        VALID_SELECTION: {
          target: 'stabilizing',
          actions: assign({
            snapshot: ({ event }) => event.type === 'VALID_SELECTION' ? event.snapshot : null,
            revision: ({ context }) => context.revision + 1,
          }),
        },
      },
    },
    stabilizing: {
      after: {
        120: 'armed', // Wait 120ms for selection to stabilize
      },
      on: {
        SELECTION_CHANGED: 'idle',
        SELECTION_COLLAPSED: 'idle',
        VALID_SELECTION: {
          target: 'stabilizing',
          actions: assign({
            snapshot: ({ event }) => event.type === 'VALID_SELECTION' ? event.snapshot : null,
            revision: ({ context }) => context.revision + 1,
          }),
        },
      },
    },
    armed: {
      // Trigger button visible, NO network request
      on: {
        EXPLICIT_TRIGGER: 'extracting',
        AUTO_TRIGGER: 'extracting',
        SELECTION_CHANGED: {
          target: 'stabilizing',
          actions: assign({
            snapshot: null,
            context: null,
            requestId: null,
          }),
        },
        SELECTION_COLLAPSED: 'idle',
        DISMISS: 'idle',
        ESC: 'idle',
      },
    },
    extracting: {
      // Extracting context from page (local, fast)
      on: {
        CONTEXT_READY: {
          target: 'explaining',
          actions: assign({
            context: ({ event }) => event.type === 'CONTEXT_READY' ? event.context : null,
          }),
        },
        CANCEL: 'cancelled',
        SELECTION_CHANGED: 'idle',
      },
    },
    explaining: {
      // Waiting for model response (can be cancelled)
      on: {
        EXPLAIN_SUCCEEDED: 'result',
        EXPLAIN_FAILED: {
          target: 'failure',
          actions: assign({
            error: ({ event }) => event.type === 'EXPLAIN_FAILED' ? event.error : null,
          }),
        },
        CANCEL: 'cancelled',
        SELECTION_CHANGED: 'idle',
      },
    },
    result: {
      // Explanation displayed
      on: {
        SAVE: 'result', // Save handled by parent
        EXPAND: 'result',
        DISMISS: 'idle',
        ESC: 'idle',
        SELECTION_CHANGED: {
          target: 'stabilizing',
          actions: assign({
            snapshot: null,
            context: null,
            requestId: null,
          }),
        },
      },
    },
    failure: {
      // Explanation failed, can retry or save raw selection
      on: {
        RETRY: 'extracting',
        SAVE: 'result', // Save to Inbox
        DISMISS: 'idle',
        ESC: 'idle',
      },
    },
    cancelled: {
      // User cancelled
      on: {
        SELECTION_CHANGED: 'idle',
        DISMISS: 'idle',
      },
    },
  },
});
