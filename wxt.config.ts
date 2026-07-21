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
        suggested_key: { default: 'Alt+X' },
        description: 'Close LexiFlow page UI',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
});
