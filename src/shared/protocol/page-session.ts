/**
 * Page session identity — uniquely identifies a document instance within a tab.
 * Tab IDs are reused across navigations, so we need documentId + urlAtCapture
 * to detect stale results. See technical-design/02 §6.
 */
export type PageSessionRef = {
  tabId: number;
  frameId: number;       // P0: always 0 (top-level frame only)
  documentId: string;    // Chrome documentId or content-script-generated session UUID
  urlAtCapture: string;  // URL at the time of capture (no fragment)
};

/**
 * Create a new page session ref for the current document.
 * Called by content script on first load.
 */
export function createPageSessionRef(
  tabId: number,
  url: string,
  documentId?: string,
): PageSessionRef {
  return {
    tabId,
    frameId: 0,
    documentId: documentId || crypto.randomUUID(),
    urlAtCapture: url.split('#')[0], // Remove fragment for comparison
  };
}

/**
 * Check if a page session ref is still valid (same document, same URL).
 * Used by the service worker to discard stale results after navigation.
 */
export function isPageSessionCurrent(
  session: PageSessionRef,
  currentTabId: number,
  currentUrl: string,
): boolean {
  if (session.tabId !== currentTabId) return false;
  if (session.urlAtCapture !== currentUrl.split('#')[0]) return false;
  return true;
}

/**
 * Result when a stale document is detected.
 */
export const STALE_DOCUMENT_ERROR = {
  code: 'CONFLICT' as const,
  userMessage: 'The page has navigated since the request started. Please try again.',
  retryable: false,
};
