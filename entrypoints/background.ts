import { defineBackground } from 'wxt/utils/define-background';

// LexiFlow Background Service Worker
// MV3: event-driven, can be terminated at any time. No in-memory truth.

export default defineBackground(() => {
  // Set storage access level to trusted contexts only.
  // This prevents content scripts from reading sensitive settings/credentials.
  chrome.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((err) => {
      console.error('[LexiFlow] Failed to set storage access level:', err);
    });

  // Register content scripts for already-authorized origins on startup.
  // This is idempotent — re-registering the same origin is a no-op.
  chrome.permissions.getAll().then((permissions) => {
    const origins = permissions.origins ?? [];
    const httpOrigins = origins.filter(
      (o) => o.startsWith('http://') || o.startsWith('https://'),
    );
    if (httpOrigins.length > 0) {
      chrome.scripting
        .registerContentScripts([
          {
            id: 'lexiflow-content',
            matches: httpOrigins,
            js: ['/content.js'],
            runAt: 'document_idle',
            allFrames: false,
          },
        ])
        .catch((err) => {
          console.error('[LexiFlow] Failed to register content scripts:', err);
        });
    }
  });

  // Handle permission changes — dynamically register/unregister content scripts.
  chrome.permissions.onAdded.addListener((permissions) => {
    const origins = permissions.origins ?? [];
    if (origins.length > 0) {
      chrome.scripting
        .registerContentScripts([
          {
            id: 'lexiflow-content',
            matches: origins,
            js: ['/content.js'],
            runAt: 'document_idle',
            allFrames: false,
          },
        ])
        .catch((err) => {
          console.error('[LexiFlow] Failed to register content scripts on permission add:', err);
        });
    }
  });

  chrome.permissions.onRemoved.addListener((permissions) => {
    const origins = permissions.origins ?? [];
    if (origins.length > 0) {
      chrome.scripting
        .unregisterContentScripts({ ids: ['lexiflow-content'] })
        .catch((err) => {
          console.error('[LexiFlow] Failed to unregister content scripts:', err);
        });
    }
  });

  // Keyboard shortcuts
  chrome.commands.onCommand.addListener((command) => {
    console.log('[LexiFlow] Command received:', command);
    // Command routing is implemented in M1 with typed messaging.
  });

  console.log('[LexiFlow] Background service worker initialized');
});
