import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { SelectionObserver } from './selection-observer';
import type { SelectionSnapshot } from './selection-validator';
import { extractContext } from './context-extractor';
import type { ContextEvidence } from './context-extractor';
import { selectionMachine } from './selection-machine';
import { SelectionTrigger } from './SelectionTrigger';
import {
  ExplanationPopover,
  type ExplanationContent,
} from './ExplanationPopover';
import type { PageSessionRef } from '@shared/protocol/page-session';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type { AiTaskEvent } from '@shared/protocol/protocol-map';

/**
 * SelectionController — orchestrates selection detection, trigger button,
 * context extraction, and the explanation popover.
 * See technical-design/03 §5-9.
 */
export interface SelectionControllerProps {
  pageSession: PageSessionRef;
  hostElement: HTMLElement;
}

export const SelectionController: React.FC<SelectionControllerProps> = ({
  pageSession,
  hostElement,
}) => {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [, setContext] = useState<ContextEvidence | null>(null);
  const [explanationContent, setExplanationContent] =
    useState<ExplanationContent | null>(null);
  const [popoverError, setPopoverError] = useState<string | undefined>(undefined);
  const [popoverState, setPopoverState] = useState<'loading' | 'result' | 'failure'>('loading');
  const popoverStateRef = useRef(popoverState);
  popoverStateRef.current = popoverState;

  const observerRef = useRef<SelectionObserver | null>(null);
  const [state, send] = useMachine(selectionMachine);

  // Initialize selection observer
  useEffect(() => {
    const observer = new SelectionObserver(pageSession, hostElement);
    observerRef.current = observer;

    observer.onChange((newSnapshot) => {
      if (newSnapshot) {
        setSnapshot(newSnapshot);
        send({ type: 'VALID_SELECTION', snapshot: newSnapshot });
      } else {
        send({ type: 'SELECTION_COLLAPSED' });
      }
    });

    observer.start();

    return () => {
      observer.stop();
    };
  }, [pageSession, hostElement, send]);

  // Handle explicit trigger (click or keyboard shortcut)
  const handleTrigger = useCallback(() => {
    send({ type: 'EXPLICIT_TRIGGER' });

    // Extract context locally (fast, no network)
    if (snapshot) {
      const extractedContext = extractContext(snapshot);
      setContext(extractedContext);
      send({ type: 'CONTEXT_READY', context: extractedContext });

      // Send explain request to background via message
      setPopoverState('loading');
      setPopoverError(undefined);

      const requestId = crypto.randomUUID();
      sendMessage<AppResult<{ accepted: boolean; taskId: string }>>('selection/explain', {
        requestId,
        selection: snapshot.text,
        context: JSON.stringify(extractedContext),
        source: {
          origin: snapshot.page.urlAtCapture,
          urlWithoutFragment: snapshot.page.urlAtCapture,
        },
        task: 'quick-explain',
      }).then((response) => {
        if (!response.ok || !response.data.accepted) {
          setPopoverState('failure');
          send({ type: 'EXPLAIN_FAILED' });
          return;
        }

        // Poll for task completion via streaming events (every 300ms)
        const taskId = response.data.taskId;
        const pollInterval = setInterval(async () => {
          try {
            const eventResponse = await sendMessage<AppResult<AiTaskEvent | null>>('aiTask/event', { taskId });
            if (!eventResponse.ok || !eventResponse.data) {
              return;
            }
            const event = eventResponse.data;

            if (event.type === 'succeeded' && event.result) {
              clearInterval(pollInterval);
              // The result is an AiTaskResult with .value containing the explanation
              const result = event.result as { value?: ExplanationContent };
              const content = result.value || (event.result as ExplanationContent);
              setExplanationContent(content);
              setPopoverState('result');
              send({ type: 'EXPLAIN_SUCCEEDED' });
            } else if (event.type === 'failed' || event.type === 'cancelled') {
              clearInterval(pollInterval);
              // Show the actual error message from the background
              const errorMsg = 'error' in event ? (event as any).error : undefined;
              setPopoverError(errorMsg);
              setPopoverState('failure');
              send({ type: 'EXPLAIN_FAILED' });
            }
            // For queued/validating/delta events, continue polling
          } catch (err) {
            clearInterval(pollInterval);
            setPopoverError(err instanceof Error ? err.message : 'Request failed');
            setPopoverState('failure');
            send({ type: 'EXPLAIN_FAILED' });
          }
        }, 300);

        // Timeout after 30 seconds
        setTimeout(() => {
          clearInterval(pollInterval);
          if (popoverStateRef.current === 'loading') {
            setPopoverError('Request timed out. The model service may be slow.');
            setPopoverState('failure');
            send({ type: 'EXPLAIN_FAILED' });
          }
        }, 30000);
      }).catch((err) => {
        setPopoverError(err instanceof Error ? err.message : 'Request failed');
        setPopoverState('failure');
        send({ type: 'EXPLAIN_FAILED' });
      });
    }
  }, [snapshot, send]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+L: trigger explanation
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        if (state.matches('armed') && snapshot) {
          handleTrigger();
        }
      }

      // Escape: close
      if (e.key === 'Escape') {
        if (
          state.matches('armed') ||
          state.matches('result') ||
          state.matches('failure') ||
          state.matches('explaining')
        ) {
          send({ type: 'ESC' });
          setSnapshot(null);
          setContext(null);
          setExplanationContent(null);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, snapshot, handleTrigger, send]);

  // Handle scroll/resize — close popover if it would go off-screen
  useEffect(() => {
    const handleScroll = () => {
      if (
        state.matches('result') ||
        state.matches('failure') ||
        state.matches('explaining')
      ) {
        // Keep popover open but repositioning is handled by Floating UI (M3+)
        // For now, dismiss on scroll to avoid stale positioning
        send({ type: 'DISMISS' });
        setSnapshot(null);
        setContext(null);
        setExplanationContent(null);
      }
    };

    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, [state, send]);

  // Calculate trigger button position
  const triggerPosition = snapshot
    ? {
        x: snapshot.anchor.unionRect.x,
        y: snapshot.anchor.unionRect.y,
      }
    : { x: 0, y: 0 };

  // Calculate popover position (below selection, or above if not enough space)
  const popoverPosition = snapshot
    ? {
        x: Math.min(snapshot.anchor.unionRect.x, window.innerWidth - 400),
        y: snapshot.anchor.unionRect.y + snapshot.anchor.unionRect.height + 8,
      }
    : { x: 0, y: 0 };

  return (
    <>
      {/* Trigger button — shown when armed */}
      {state.matches('armed') && snapshot && (
        <SelectionTrigger
          position={triggerPosition}
          onTrigger={handleTrigger}
          shortcutHint="Alt+L"
        />
      )}

      {/* Popover — shown when explaining, result, or failure */}
      {(state.matches('explaining') ||
        state.matches('result') ||
        state.matches('failure')) &&
        snapshot && (
          <ExplanationPopover
            state={
              state.matches('explaining')
                ? 'loading'
                : state.matches('failure')
                  ? 'failure'
                  : 'result'
            }
            selectedText={snapshot.text}
            content={explanationContent || undefined}
            error={popoverError}
            position={popoverPosition}
            onSave={async () => {
              // Save as card: send capture/save request to background
              try {
                const url = snapshot.page.urlAtCapture;
                const domain = url.split('/')[2] || url;
                const result = await sendMessage<AppResult<{
                  captureId: string;
                  status: string;
                  cardId?: string;
                  message: string;
                }>>('capture/save', {
                  requestId: crypto.randomUUID(),
                  selectedText: snapshot.text,
                  context: {
                    pageTitle: document.title,
                    url,
                    extractedAt: new Date().toISOString(),
                    quality: 'full',
                  },
                  pageUrl: url,
                  pageTitle: document.title,
                  domain,
                  requestedAction: 'save',
                  idempotencyKey: crypto.randomUUID(),
                });
                if (result.ok) {
                  console.log('[LexiFlow] Saved as card:', result.data.status);
                }
              } catch (err) {
                console.error('[LexiFlow] Save failed:', err);
              }
            }}
            onSaveToInbox={async () => {
              // Save to inbox
              try {
                const url = snapshot.page.urlAtCapture;
                const domain = url.split('/')[2] || url;
                const result = await sendMessage<AppResult<{
                  captureId: string;
                  status: string;
                  message: string;
                }>>('capture/save', {
                  requestId: crypto.randomUUID(),
                  selectedText: snapshot.text,
                  context: {
                    pageTitle: document.title,
                    url,
                    extractedAt: new Date().toISOString(),
                    quality: 'full',
                  },
                  pageUrl: url,
                  pageTitle: document.title,
                  domain,
                  requestedAction: 'save-to-inbox',
                  idempotencyKey: crypto.randomUUID(),
                });
                if (result.ok) {
                  console.log('[LexiFlow] Saved to inbox:', result.data.status);
                }
              } catch (err) {
                console.error('[LexiFlow] Save to inbox failed:', err);
              }
            }}
            onExpand={() => {
              // Open dashboard card detail
              console.log('[LexiFlow] Expand');
            }}
            onClose={() => {
              send({ type: 'DISMISS' });
              setSnapshot(null);
              setContext(null);
              setExplanationContent(null);
            }}
            onRetry={() => {
              send({ type: 'RETRY' });
              handleTrigger();
            }}
          />
        )}
    </>
  );
};
