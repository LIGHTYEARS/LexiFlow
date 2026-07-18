import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { validateEnvelope } from '@shared/protocol/envelope';
import type { MessageEnvelope } from '@shared/protocol/envelope';

// LexiFlow Content Script
// Injects ShadowRoot UI into authorized pages. Selection handling is implemented in M3.
// See technical-design/02 §8.1 and technical-design/03.

export default defineContentScript({
  // No static matches — content script is registered at runtime
  // only for origins the user has explicitly authorized (see background.ts).
  matches: [],
  runAt: 'document_idle',
  registration: 'runtime',

  async main(ctx) {
    // Placeholder: full selection trigger + explanation popover in M3.
    console.log('[LexiFlow] Content script loaded on:', window.location.href);

    // Create a minimal ShadowRoot UI host.
    const ui = await createShadowRootUi(ctx, {
      name: 'lexiflow-content-ui',
      position: 'inline',
      append: 'last',
      onMount(uiContainer) {
        uiContainer.textContent = 'LexiFlow ready';
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
          // Not a valid envelope — ignore (could be from other extensions)
          return false;
        }

        // Handle commands from keyboard shortcuts
        if (envelope.type.startsWith('command/')) {
          const command = envelope.type.slice('command/'.length);
          handleCommand(command);
          sendResponse({ ok: true, requestId: envelope.requestId, data: undefined });
          return true;
        }

        // Handle other message types (M3+: selection, explanation requests)
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
 * Handle keyboard commands forwarded from background.
 * Full implementation in M3.
 */
function handleCommand(command: string): void {
  console.log('[LexiFlow] Command received in content:', command);
  // M3: implement trigger explanation, save to inbox, close UI, etc.
}
