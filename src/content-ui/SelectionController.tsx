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

      // M4: Send explain request to background via message
      // For M3, simulate with a delay to show loading state
      setPopoverState('loading');

      // Placeholder: actual model request in M4
      setTimeout(() => {
        setExplanationContent({
          type: 'word',
          chineseMeaning: '（模型解释将在 M4 实现）',
          englishMeaning: '(Model explanation will be implemented in M4)',
          contextMeaning: '文中含义：此处指...',
          examples: ['Example sentence here.'],
        });
        setPopoverState('result');
        send({ type: 'EXPLAIN_SUCCEEDED' });
      }, 800);
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
            error={undefined}
            position={popoverPosition}
            onSave={() => {
              // M5: send save command to background
              console.log('[LexiFlow] Save card');
            }}
            onSaveToInbox={() => {
              // M5: send save-to-inbox command to background
              console.log('[LexiFlow] Save to Inbox');
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
