import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { validateEnvelope } from '@shared/protocol/envelope';
import type { MessageEnvelope } from '@shared/protocol/envelope';
import { createPageSessionRef } from '@shared/protocol/page-session';
import { SelectionController } from '@content-ui/SelectionController';
import { sendMessage } from '@infra/messaging/browser-runtime';
import React from 'react';
import { createRoot } from 'react-dom/client';

// LexiFlow Content Script
// Injects ShadowRoot UI into authorized pages.
// See technical-design/02 §8.1 and technical-design/03.

// Module-level reference to the ShadowRoot UI host element, used to dispatch
// custom events to the SelectionController for commands that originate from
// Chrome's command API (Alt+I, Alt+R, etc.) rather than keyboard events.
let hostElement: HTMLElement | null = null;

export default defineContentScript({
  // No static matches — content script is registered at runtime
  // only for origins the user has explicitly authorized (see background.ts).
  matches: [],
  runAt: 'document_idle',
  registration: 'runtime',

  async main(ctx) {
    console.log('[LexiFlow] Content script loaded on:', window.location.href);

    // Create page session ref for this document
    const tabId = await getTabId();
    const runtimeWithDocumentId = chrome.runtime as unknown as { documentId?: string };
    const pageSession = createPageSessionRef(
      tabId,
      window.location.href,
      // Use Chrome's documentId if available
      runtimeWithDocumentId.documentId,
    );

    // Create ShadowRoot UI host
    const ui = await createShadowRootUi(ctx, {
      name: 'lexiflow-content-ui',
      position: 'inline',
      append: 'last',
      onMount(uiContainer) {
        // Store host element reference so handleCommand can dispatch
        // custom events to the SelectionController.
        hostElement = uiContainer;

        // Render the SelectionController into the ShadowRoot
        const root = createRoot(uiContainer);
        root.render(
          React.createElement(SelectionController, {
            pageSession,
            hostElement: uiContainer,
          }),
        );
      },
    });

    ui.mount();

    // ── Message listener: handle commands from background ──
    chrome.runtime.onMessage.addListener(
      (rawEnvelope: unknown, sender, sendResponse) => {
        let envelope: MessageEnvelope;
        try {
          envelope = validateEnvelope(rawEnvelope);
        } catch {
          // Not a valid envelope — ignore
          return false;
        }

        // Handle commands from keyboard shortcuts
        if (envelope.type.startsWith('command/')) {
          const command = envelope.type.slice('command/'.length);
          handleCommand(command);
          // Response type is constrained by the handler return types (AppResult<T>)
          sendResponse({ ok: true, requestId: envelope.requestId, data: undefined });
          return true;
        }

        return false; // not handled
      },
    );

    // ── Cleanup on page unload ──
    ctx.addEventListener(window, 'unload', () => {
      ui.remove();
    });
  },
});

/**
 * Get the current tab ID.
 */
async function getTabId(): Promise<number> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  } catch {
    return -1;
  }
}

/**
 * Handle keyboard commands forwarded from background.
 *
 * Commands arrive from Chrome's command API (Alt+L, Alt+I, Alt+R, Alt+X)
 * via the background script, which forwards them as `command/{name}` messages.
 *
 * - open-explanation (Alt+L): dispatched to the SelectionController via a
 *   custom DOM event. The SelectionController also handles Alt+L directly via
 *   its own keydown listener, so this covers the command-API path.
 * - save-to-inbox (Alt+I): captures the current page selection and sends a
 *   `capture/save` message with `requestedAction: 'save-to-inbox'`.
 * - start-review (Alt+R): opens the dashboard review page in a new tab.
 * - close-ui (Alt+X): dispatched to the SelectionController via a custom
 *   DOM event. The SelectionController also handles Escape directly.
 */
function handleCommand(command: string): void {
  console.log('[LexiFlow] Command received in content:', command);

  switch (command) {
    case 'open-explanation': {
      // The SelectionController handles Alt+L via its own keydown listener.
      // Dispatch a custom event so the command-API path also triggers it.
      if (hostElement) {
        hostElement.dispatchEvent(new CustomEvent('lexiflow:open-explanation'));
      }
      break;
    }

    case 'save-to-inbox': {
      // Capture the current selection from the page and save to inbox.
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? '';
      if (!selectedText) {
        console.log('[LexiFlow] No selection to save to inbox');
        break;
      }

      const url = window.location.href;
      const domain = url.split('/')[2] || url;

      sendMessage<{
        captureId: string;
        status: string;
        cardId?: string;
        message: string;
      }>('capture/save', {
        requestId: crypto.randomUUID(),
        selectedText,
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
      })
        .then((result) => {
          console.log('[LexiFlow] Saved to inbox:', result.status);
        })
        .catch((err) => {
          console.error('[LexiFlow] Save to inbox failed:', err);
        });
      break;
    }

    case 'start-review': {
      // Open the dashboard review page.
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#/review') });
      break;
    }

    case 'close-ui': {
      // The SelectionController handles Escape via its own keydown listener.
      // Dispatch a custom event so the command-API path also triggers it.
      if (hostElement) {
        hostElement.dispatchEvent(new CustomEvent('lexiflow:close-ui'));
      }
      break;
    }

    default:
      console.warn('[LexiFlow] Unknown command:', command);
  }
}
