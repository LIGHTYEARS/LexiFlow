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
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { PageSessionRef } from '@shared/protocol/page-session';
import type {
  AiTaskSnapshot,
  ExplainAccepted,
  SaveCaptureResult,
} from '@shared/protocol/protocol-map';
import type { QuickExplainResult } from '@adapters/ai/ai-result-schemas';
import type { AppResult } from '@shared/protocol/envelope';

/**
 * SelectionController — orchestrates selection detection, trigger button,
 * context extraction, and the explanation popover, wired to the real background
 * AI + capture pipeline. See technical-design/03 §5-9 and 05 §7.
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
  const contextRef = useRef<ContextEvidence | null>(null);
  const [explanationContent, setExplanationContent] = useState<ExplanationContent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [saveStatus, setSaveStatus] = useState<string | undefined>(undefined);
  // The taskId of the in-flight explain request, used for cancel + stale-guard.
  const activeTaskRef = useRef<string | null>(null);

  const observerRef = useRef<SelectionObserver | null>(null);
  const [state, send] = useMachine(selectionMachine);

  const reset = useCallback(() => {
    setSnapshot(null);
    contextRef.current = null;
    setExplanationContent(null);
    setErrorMsg(undefined);
    setSaveStatus(undefined);
    activeTaskRef.current = null;
  }, []);

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
    return () => observer.stop();
  }, [pageSession, hostElement, send]);

  // Run the explanation request against the background AI task pipeline.
  const runExplain = useCallback(
    async (snap: SelectionSnapshot, context: ContextEvidence) => {
      setErrorMsg(undefined);
      const requestId = crypto.randomUUID();
      try {
        const res = await sendMessage<AppResult<ExplainAccepted & { snapshot: AiTaskSnapshot }>>(
          'selection/explain',
          {
            requestId,
            selection: snap.text,
            context: {
              sentenceBefore: context.sentenceBefore,
              sentenceContaining: context.sentenceContaining,
              sentenceAfter: context.sentenceAfter,
              paragraphExcerpt: context.paragraphExcerpt,
              nearestHeading: context.nearestHeading,
              pageTitle: context.pageTitle,
              url: context.url,
              siteName: context.siteName,
              extractedAt: context.extractedAt,
              quality: context.quality,
            },
            source: { origin: window.location.origin, urlWithoutFragment: context.url },
            task: 'quick-explain',
          },
        );

        if (!res.ok) {
          send({ type: 'EXPLAIN_FAILED', error: res.error.userMessage });
          setErrorMsg(res.error.userMessage);
          return;
        }
        activeTaskRef.current = res.data.taskId;
        const snapshot = res.data.snapshot;
        if (snapshot.state === 'succeeded' && snapshot.result) {
          const result = snapshot.result as QuickExplainResult;
          setExplanationContent({
            type: result.type,
            chineseMeaning: result.chineseMeaning,
            englishMeaning: result.englishMeaning,
            contextMeaning: result.contextMeaning,
            examples: result.examples,
          });
          send({ type: 'EXPLAIN_SUCCEEDED' });
        } else if (snapshot.state === 'cancelled') {
          // Ignore — cancellation already handled locally.
        } else {
          const msg = snapshot.error || 'Could not generate an explanation.';
          send({ type: 'EXPLAIN_FAILED', error: msg });
          setErrorMsg(msg);
        }
      } catch {
        const msg = 'Could not reach LexiFlow. You can still save the text to Inbox.';
        send({ type: 'EXPLAIN_FAILED', error: msg });
        setErrorMsg(msg);
      }
    },
    [send],
  );

  // Handle explicit trigger (click or keyboard shortcut)
  const handleTrigger = useCallback(() => {
    if (!snapshot) return;
    send({ type: 'EXPLICIT_TRIGGER' });
    const extractedContext = extractContext(snapshot);
    contextRef.current = extractedContext;
    send({ type: 'CONTEXT_READY', context: extractedContext });
    void runExplain(snapshot, extractedContext);
  }, [snapshot, send, runExplain]);

  // Cancel an in-flight explanation (§7.6).
  const handleCancel = useCallback(() => {
    if (activeTaskRef.current) {
      void sendMessage('aiTask/cancel', { taskId: activeTaskRef.current });
    }
    send({ type: 'CANCEL' });
  }, [send]);

  // Save (to library or Inbox). Reports the resulting status (§6.1.7, §19.1).
  const doSave = useCallback(
    async (action: 'save' | 'save-to-inbox') => {
      const snap = snapshot;
      const context = contextRef.current;
      if (!snap) return;
      setSaveStatus('saving');
      const ctx = context ?? extractContext(snap);
      try {
        const res = await sendMessage<AppResult<SaveCaptureResult>>('capture/save', {
          requestId: crypto.randomUUID(),
          selectedText: snap.text,
          context: {
            sentenceBefore: ctx.sentenceBefore,
            sentenceContaining: ctx.sentenceContaining,
            sentenceAfter: ctx.sentenceAfter,
            paragraphExcerpt: ctx.paragraphExcerpt,
            nearestHeading: ctx.nearestHeading,
            pageTitle: ctx.pageTitle,
            url: ctx.url,
            siteName: ctx.siteName,
            extractedAt: ctx.extractedAt,
            quality: ctx.quality,
          },
          pageUrl: ctx.url,
          pageTitle: ctx.pageTitle,
          siteName: ctx.siteName,
          requestedAction: action,
        });
        if (!res.ok) {
          setSaveStatus('failed: ' + res.error.userMessage);
          return;
        }
        setSaveStatus(statusLabel(res.data.status));
        // Auto-close shortly after a successful save.
        window.setTimeout(() => {
          send({ type: 'DISMISS' });
          reset();
        }, 1200);
      } catch {
        setSaveStatus('failed: could not save');
      }
    },
    [snapshot, send, reset],
  );

  // Keyboard shortcuts (fallback to local handling; background also forwards).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        if (state.matches('armed') && snapshot) handleTrigger();
      }
      if (e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        if (snapshot) void doSave('save-to-inbox');
      }
      if (e.key === 'Escape') {
        if (state.matches('explaining') || state.matches('extracting')) {
          handleCancel();
        } else if (state.matches('armed') || state.matches('result') || state.matches('failure')) {
          send({ type: 'ESC' });
          reset();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, snapshot, handleTrigger, handleCancel, doSave, send, reset]);

  // Listen for commands forwarded from the background (keyboard shortcuts).
  useEffect(() => {
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<string>).detail;
      if (command === 'open-explanation' && state.matches('armed') && snapshot) handleTrigger();
      else if (command === 'save-to-inbox' && snapshot) void doSave('save-to-inbox');
      else if (command === 'close-ui') {
        send({ type: 'DISMISS' });
        reset();
      }
    };
    window.addEventListener('lexiflow:command', onCommand);
    return () => window.removeEventListener('lexiflow:command', onCommand);
  }, [state, snapshot, handleTrigger, doSave, send, reset]);

  const triggerPosition = snapshot
    ? { x: snapshot.anchor.unionRect.x, y: snapshot.anchor.unionRect.y }
    : { x: 0, y: 0 };

  const popoverPosition = snapshot
    ? {
        x: Math.min(snapshot.anchor.unionRect.x, window.innerWidth - 400),
        y: snapshot.anchor.unionRect.y + snapshot.anchor.unionRect.height + 8,
      }
    : { x: 0, y: 0 };

  const popoverActive =
    state.matches('extracting') ||
    state.matches('explaining') ||
    state.matches('result') ||
    state.matches('failure');

  return (
    <>
      {state.matches('armed') && snapshot && (
        <SelectionTrigger position={triggerPosition} onTrigger={handleTrigger} shortcutHint="Alt+L" />
      )}

      {popoverActive && snapshot && (
        <ExplanationPopover
          state={
            state.matches('result')
              ? 'result'
              : state.matches('failure')
                ? 'failure'
                : 'loading'
          }
          selectedText={snapshot.text}
          content={explanationContent || undefined}
          error={errorMsg}
          saveStatus={saveStatus}
          position={popoverPosition}
          onSave={() => void doSave('save')}
          onSaveToInbox={() => void doSave('save-to-inbox')}
          onExpand={() => void sendMessage('navigation/open', { destination: 'dashboard' })}
          onCancel={handleCancel}
          onClose={() => {
            send({ type: 'DISMISS' });
            reset();
          }}
          onRetry={handleTrigger}
        />
      )}
    </>
  );
};

function statusLabel(status: SaveCaptureResult['status']): string {
  switch (status) {
    case 'new-card':
      return 'Saved as new card';
    case 'appended':
      return 'Appended to existing card';
    case 'skipped':
      return 'Skipped (duplicate)';
    case 'inbox':
      return 'Saved to Inbox';
    case 'failed':
      return 'Save failed';
  }
}
