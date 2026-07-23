import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { validateEnvelope } from '@shared/protocol/envelope';
import type { MessageEnvelope } from '@shared/protocol/envelope';
import { createPageSessionRef } from '@shared/protocol/page-session';
import { SelectionController } from '@content-ui/SelectionController';
import React from 'react';
import { createRoot } from 'react-dom/client';

// LexiFlow Content Script
// Injects ShadowRoot UI into authorized pages.
// See technical-design/02 §8.1 and technical-design/03.

export default defineContentScript({
  // Inject into all http/https pages. The SelectionController checks site policy
  // and only shows the trigger on authorized sites.
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',

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
 */
function handleCommand(command: string): void {
  console.log('[LexiFlow] Command received in content:', command);
  // Command handling is done via keyboard events in SelectionController
  // (Alt+L triggers explanation, Escape closes)
}
