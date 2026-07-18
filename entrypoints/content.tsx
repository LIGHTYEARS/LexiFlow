import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';

// LexiFlow Content Script
// Injects ShadowRoot UI into authorized pages. Selection handling is implemented in M3.

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
  },
});
