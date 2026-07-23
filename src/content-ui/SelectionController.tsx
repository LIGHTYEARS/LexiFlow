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
  const [, setPopoverState] = useState<'loading' | 'result' | 'failure'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [sitePolicy, setSitePolicy] = useState<{ enabled: boolean; autoExplain: boolean } | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const observerRef = useRef<SelectionObserver | null>(null);
  const [state, send] = useMachine(selectionMachine);

  // Fetch site policy (enabled + autoExplain) on mount
  useEffect(() => {
    chrome.runtime.sendMessage({
      protocolVersion: 1,
      type: 'settings/site-policy',
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { origin: window.location.origin },
    }).then((res) => {
      if (res?.ok) {
        setSitePolicy({ enabled: res.data.enabled, autoExplain: res.data.autoExplain });
      }
    }).catch(() => {
      // Default to enabled if policy fetch fails
      setSitePolicy({ enabled: true, autoExplain: false });
    });
  }, []);

  // Initialize selection observer
  useEffect(() => {
    const observer = new SelectionObserver(pageSession, hostElement);
    observerRef.current = observer;

    observer.onChange((newSnapshot) => {
      if (newSnapshot) {
        setSnapshot(newSnapshot);
        send({ type: 'VALID_SELECTION', snapshot: newSnapshot });
        // Auto-explain if enabled and site is enabled
        if (sitePolicy?.enabled && sitePolicy?.autoExplain) {
          send({ type: 'AUTO_TRIGGER' });
          setTimeout(() => handleTrigger(newSnapshot), 50);
        }
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
  const handleTrigger = useCallback((snap?: SelectionSnapshot) => {
    const activeSnapshot = snap || snapshot;
    if (!activeSnapshot) return;
    send({ type: 'EXPLICIT_TRIGGER' });

    // Extract context locally (fast, no network)
    const extractedContext = extractContext(activeSnapshot);
    setContext(extractedContext);
    send({ type: 'CONTEXT_READY', context: extractedContext });

    setPopoverState('loading');
    setErrorMessage('');
    setExplanationContent(null);

    // Send explain request to background
    const requestId = crypto.randomUUID();
    chrome.runtime.sendMessage({
      protocolVersion: 1,
      type: 'selection/explain',
      requestId,
      occurredAt: new Date().toISOString(),
      payload: {
        requestId,
        selection: activeSnapshot.text,
        context: extractedContext,
        source: { origin: 'web_page', urlWithoutFragment: window.location.href.split('#')[0] },
        task: 'quick-explain',
      },
    }).then((res) => {
      if (!res?.ok) {
        setPopoverState('failure');
        setErrorMessage(res?.error?.userMessage || 'Failed to start explanation');
        send({ type: 'EXPLAIN_FAILED' });
        return;
      }
      const taskId: string = res.data.taskId;
      currentTaskIdRef.current = taskId;
      // Poll for task completion
      pollTaskStatus(taskId);
    }).catch((err) => {
      setPopoverState('failure');
      setErrorMessage('Communication error: ' + String(err));
      send({ type: 'EXPLAIN_FAILED' });
    });
  }, [snapshot, send]);

  // Poll AI task status until done
  const pollTaskStatus = useCallback((taskId: string) => {
    const poll = () => {
      chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'aiTask/getStatus',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { taskId },
      }).then((res) => {
        if (!res?.ok) {
          setPopoverState('failure');
          setErrorMessage(res?.error?.userMessage || 'Failed to get task status');
          send({ type: 'EXPLAIN_FAILED' });
          return;
        }
        const status = res.data;
        if (status.state === 'succeeded' && status.result) {
          const r = status.result as {
            type?: string;
            chineseMeaning?: string;
            englishMeaning?: string;
            contextMeaning?: string;
            examples?: string[];
          };
          setExplanationContent({
            type: r.type as ExplanationContent['type'],
            chineseMeaning: r.chineseMeaning,
            englishMeaning: r.englishMeaning,
            contextMeaning: r.contextMeaning,
            examples: r.examples,
          });
          setPopoverState('result');
          send({ type: 'EXPLAIN_SUCCEEDED' });
        } else if (status.state === 'failed') {
          setPopoverState('failure');
          setErrorMessage(status.error || 'Explanation failed');
          send({ type: 'EXPLAIN_FAILED' });
        } else if (status.state === 'cancelled') {
          setPopoverState('failure');
          setErrorMessage('Cancelled');
          send({ type: 'EXPLAIN_FAILED' });
        } else {
          // Still running — poll again
          pollTimerRef.current = setTimeout(poll, 500);
        }
      }).catch((err) => {
        setPopoverState('failure');
        setErrorMessage('Communication error: ' + String(err));
        send({ type: 'EXPLAIN_FAILED' });
      });
    };
    poll();
  }, [send]);

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

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

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

  // Send capture to background (save or save-to-inbox)
  const handleSave = useCallback((action: 'save' | 'save-to-inbox') => {
    if (!snapshot) return;
    const requestId = crypto.randomUUID();
    chrome.runtime.sendMessage({
      protocolVersion: 1,
      type: 'capture/save',
      requestId,
      occurredAt: new Date().toISOString(),
      payload: {
        requestId,
        selectedText: snapshot.text,
        context: extractContext(snapshot),
        pageUrl: window.location.href,
        pageTitle: document.title,
        domain: window.location.hostname,
        requestedAction: action,
      },
    }).then((res) => {
      if (res?.ok) {
        // Close popover after successful save
        send({ type: 'DISMISS' });
        setSnapshot(null);
        setExplanationContent(null);
      } else {
        setErrorMessage(res?.error?.userMessage || 'Save failed');
        setPopoverState('failure');
      }
    }).catch((err) => {
      setErrorMessage('Save error: ' + String(err));
      setPopoverState('failure');
    });
  }, [snapshot, send]);

  return (
    <>
      {/* Trigger button — shown when armed */}
      {state.matches('armed') && snapshot && sitePolicy?.enabled && (
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
            error={errorMessage || undefined}
            position={popoverPosition}
            onSave={() => handleSave('save')}
            onSaveToInbox={() => handleSave('save-to-inbox')}
            onExpand={() => {
              chrome.runtime.sendMessage({
                protocolVersion: 1,
                type: 'navigation/open',
                requestId: crypto.randomUUID(),
                occurredAt: new Date().toISOString(),
                payload: { destination: 'cards' },
              });
            }}
            onClose={() => {
              if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
              if (currentTaskIdRef.current) {
                chrome.runtime.sendMessage({
                  protocolVersion: 1,
                  type: 'aiTask/cancel',
                  requestId: crypto.randomUUID(),
                  occurredAt: new Date().toISOString(),
                  payload: { taskId: currentTaskIdRef.current },
                }).catch(() => {});
              }
              send({ type: 'DISMISS' });
              setSnapshot(null);
              setContext(null);
              setExplanationContent(null);
              setErrorMessage('');
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
