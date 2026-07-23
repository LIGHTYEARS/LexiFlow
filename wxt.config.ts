import { defineConfig } from 'wxt';

export default defineConfig({
  modules: [],
  manifest: {
    name: 'LexiFlow',
    description: 'Personal English reading & expression learning extension',
    version: '0.1.0',
    manifest_version: 3,
    permissions: ['storage', 'sidePanel', 'scripting', 'commands'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'LexiFlow',
      default_popup: 'popup.html',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'open-explanation': {
        suggested_key: { default: 'Alt+L' },
        description: 'Open LexiFlow explanation for current selection',
      },
      'save-to-inbox': {
        suggested_key: { default: 'Alt+I' },
        description: 'Save current selection to Inbox',
      },
      'start-review': {
        suggested_key: { default: 'Alt+R' },
        description: 'Start today review',
      },
      'close-ui': {
        // No suggested_key: Chrome rejects Escape as a command accelerator, and
        // Esc-to-close is already handled locally by the content script keydown
        // listener. User may assign a key in chrome://extensions/shortcuts.
        description: 'Close LexiFlow page UI',
      },
      // No suggested_key (Chrome MV3 limits suggested keys to 4); user can
      // assign these in chrome://extensions/shortcuts (§16.1).
      'save-selection': {
        description: 'Save current selection as a card',
      },
      'expand-explanation': {
        description: 'Expand the current explanation',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
});
