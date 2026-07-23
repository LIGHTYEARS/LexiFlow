import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';

/**
 * PageAccessPolicy — manages per-site authorization for content script injection.
 * See technical-design/02 §4.1 and technical-design/11 §3.
 *
 * Two independent permission use cases:
 * 1. PageAccessPolicy: enable content script on a specific site
 * 2. ModelOriginPermissionGateway: authorize LiteLLM service origin (separate file)
 */

/**
 * Derive the Chrome permission origin pattern from a URL.
 * Returns null if the URL is not http/https.
 */
export function deriveOriginPattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Chrome permission pattern: protocol://host/*
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return null;
  }
}

/**
 * Check if the extension has permission for the given origin pattern.
 */
export async function hasPageAccess(originPattern: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch {
    return false;
  }
}

/**
 * Request page access permission for a specific origin.
 * Must be called from a user gesture (click, keyboard shortcut).
 * See Chrome Permissions API requirements.
 */
export async function requestPageAccess(
  originPattern: string,
): Promise<{ granted: boolean; error?: AppError }> {
  try {
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    return { granted };
  } catch {
    return {
      granted: false,
      error: createError(
        'PERMISSION_DENIED',
        'Failed to request page access permission',
        false,
      ),
    };
  }
}

/**
 * Remove page access permission for a specific origin.
 * Does NOT delete already-captured local data from that origin.
 */
export async function removePageAccess(
  originPattern: string,
): Promise<{ removed: boolean }> {
  try {
    const removed = await chrome.permissions.remove({ origins: [originPattern] });
    return { removed };
  } catch {
    return { removed: false };
  }
}

/**
 * Get all currently authorized page access origins.
 */
export async function getAuthorizedOrigins(): Promise<string[]> {
  try {
    const permissions = await chrome.permissions.getAll();
    return permissions.origins ?? [];
  } catch {
    return [];
  }
}

/**
 * Register content script for authorized origins on startup.
 * Idempotent — re-registering the same origin is a no-op.
 * Called from background service worker.
 */
export async function registerContentScriptsForOrigins(
  origins: string[],
): Promise<{ registered: boolean; error?: string }> {
  const httpOrigins = origins.filter(
    (o) => o.startsWith('http://') || o.startsWith('https://'),
  );

  if (httpOrigins.length === 0) return { registered: false };

  try {
    // First unregister any existing registration to avoid conflicts
    await chrome.scripting.unregisterContentScripts({ ids: ['lexiflow-content'] }).catch(() => {});

    await chrome.scripting.registerContentScripts([
      {
        id: 'lexiflow-content',
        matches: httpOrigins,
        js: ['content-scripts/content.js'],
        runAt: 'document_idle',
        allFrames: false,
      },
    ]);
    return { registered: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LexiFlow] Failed to register content scripts:', error);
    return { registered: false, error: message };
  }
}

/**
 * Unregister the content script (when all page access is removed).
 */
export async function unregisterContentScripts(): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['lexiflow-content'] });
    // Note: permission errors are non-fatal; logged intentionally for diagnostics
  } catch (error) {
    console.error('[LexiFlow] Failed to unregister content scripts:', error);
  }
}

/**
 * Inject content script into the current tab immediately after authorization.
 * So the user doesn't need to refresh the page.
 */
export async function injectContentScriptIntoTab(tabId: number): Promise<{ injected: boolean; error?: string }> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['content-scripts/content.js'],
    });
    return { injected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LexiFlow] Failed to inject content script:', error);
    return { injected: false, error: message };
  }
}

/**
 * Check if a URL is a page where LexiFlow can run.
 * Excludes chrome://, Chrome Web Store, and other restricted pages.
 */
export function isSupportedPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only http/https pages are supported for content script injection
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    // Exclude Chrome Web Store
    if (parsed.hostname === 'chromewebstore.google.com') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
