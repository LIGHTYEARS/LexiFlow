import { defineBackground } from 'wxt/utils/define-background';
import { messageRegistry } from '@infra/messaging/message-registry';
import { initializeStorageAccess } from '@infra/storage/settings-gateway';
import {
  registerContentScriptsForOrigins,
  unregisterContentScripts,
  getAuthorizedOrigins,
} from '@infra/permissions/page-access-policy';
import { registerCoreHandlers } from '@app/core/handlers';
import { registerAiTaskHandlers } from '@app/core/ai-task-handlers';
import { registerCaptureHandlers } from '@app/core/capture-handlers';
import { registerKnowledgeHandlers, registerTagHandlers } from '@app/core/knowledge-handlers';
import { registerReviewHandlers } from '@app/core/review-handlers';
import { registerInboxHandlers } from '@app/core/inbox-handlers';
import { registerPracticeHandlers } from '@app/core/practice-handlers';
import { registerDataHandlers } from '@app/core/data-handlers';
import { runMigrations } from '@infra/db/migrations';
import { fail, createError } from '@shared/protocol/envelope';

// LexiFlow Background Service Worker
// MV3: event-driven, can be terminated at any time. No in-memory truth.
// See technical-design/02 §7.

export default defineBackground(() => {
  // ── Startup: Set storage access level ──
  initializeStorageAccess();

  // ── Startup: Run database migrations ──
  runMigrations().then((status) => {
    if (status.phase === 'error') {
      console.error('[LexiFlow] Migration failed:', status.error);
    } else if ('message' in status) {
      console.log('[LexiFlow] Database ready:', status.message);
    }
  });

  // ── Register all message handlers ──
  registerCoreHandlers();
  registerAiTaskHandlers();
  registerCaptureHandlers();
  registerKnowledgeHandlers();
  registerTagHandlers();
  registerReviewHandlers();
  registerInboxHandlers();
  registerPracticeHandlers();
  registerDataHandlers();

  // ── Startup: Register content scripts for already-authorized origins ──
  getAuthorizedOrigins().then((origins) => {
    if (origins.length > 0) {
      registerContentScriptsForOrigins(origins);
    }
  });

  // ── Message routing: validate envelope → dispatch to registered handlers ──
  chrome.runtime.onMessage.addListener(
    (rawEnvelope: unknown, sender, sendResponse) => {
      // Handle async — return true to keep the message channel open
      messageRegistry
        .handle(rawEnvelope, sender)
        .then((result) => sendResponse(result))
        .catch(() => {
          sendResponse(
            fail(
              (rawEnvelope as { requestId?: string })?.requestId || 'unknown',
              createError('INTERNAL', 'Unexpected message handling error', false),
            ),
          );
        });
      return true; // async response
    },
  );

  // ── Permission changes: dynamically register/unregister content scripts ──
  chrome.permissions.onAdded.addListener((permissions) => {
    const origins = permissions.origins ?? [];
    if (origins.length > 0) {
      // Re-register for all current authorized origins
      getAuthorizedOrigins().then((allOrigins) => {
        registerContentScriptsForOrigins(allOrigins);
      });
    }
  });

  chrome.permissions.onRemoved.addListener((permissions) => {
    const origins = permissions.origins ?? [];
    if (origins.length > 0) {
      // Check if any http/https origins remain
      getAuthorizedOrigins().then((remainingOrigins) => {
        const httpOrigins = remainingOrigins.filter(
          (o) => o.startsWith('http://') || o.startsWith('https://'),
        );
        if (httpOrigins.length === 0) {
          unregisterContentScripts();
        } else {
          registerContentScriptsForOrigins(httpOrigins);
        }
      });
    }
  });

  // ── Keyboard shortcuts ──
  chrome.commands.onCommand.addListener((command) => {
    handleCommand(command);
  });

  // ── Extension install/update ──
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[LexiFlow] Extension installed');
      // Settings are initialized lazily on first read
    } else if (details.reason === 'update') {
      console.log('[LexiFlow] Extension updated to', chrome.runtime.getManifest().version);
      // Migration is handled by Dexie versioning + settings schema version check
    }
  });

  console.log('[LexiFlow] Background service worker initialized');
});

/**
 * Handle keyboard commands.
 * Commands are routed to the active tab's content script or extension pages.
 */
async function handleCommand(command: string): Promise<void> {
  try {
    // Navigation commands open extension pages directly.
    if (command === 'start-review') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#/review') });
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return;

    // Page commands are forwarded to the content script if the page is authorized.
    const origins = await getAuthorizedOrigins();
    const tabUrl = tab.url;
    if (tabUrl) {
      const isAuthorized = origins.some((origin) => {
        const pattern = origin.replace(/\*/g, '.*');
        return new RegExp('^' + pattern + '$').test(tabUrl);
      });

      if (isAuthorized) {
        chrome.tabs.sendMessage(tab.id, {
          protocolVersion: 1,
          type: 'command/' + command,
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { command },
        }).catch(() => {
          // Content script may not be loaded yet
        });
      }
    }
  } catch (error) {
    console.error('[LexiFlow] Command handling error:', error);
  }
}
