import { createError, MAX_MESSAGE_PAYLOAD_BYTES } from '@shared/protocol/envelope';
import type { AppError, MessageEnvelope } from '@shared/protocol/envelope';
import type { PageSessionRef } from '@shared/protocol/page-session';

/**
 * Browser runtime adapter — the only module that uses Chrome messaging APIs directly.
 * All business code uses typed messages through this adapter.
 * See technical-design/02 §5 and technical-design/11 §4.
 */

/**
 * Validate a message sender. Ensures the message comes from our own extension
 * and an expected context (trusted extension page or authorized content script).
 */
export function validateSender(sender: chrome.runtime.MessageSender): {
  valid: boolean;
  error?: AppError;
} {
  // Must come from our own extension
  if (sender.id !== chrome.runtime.id) {
    return {
      valid: false,
      error: createError('PERMISSION_DENIED', 'Message from unauthorized extension', false),
    };
  }

  // Content script messages: must have a tab and frame
  if (sender.url?.startsWith('http')) {
    if (!sender.tab || !sender.tab.id) {
      return {
        valid: false,
        error: createError('PERMISSION_DENIED', 'Content script message missing tab context', false),
      };
    }
  }

  return { valid: true };
}

/**
 * Validate message payload size. See technical-design/11 §5.
 */
export function validatePayloadSize(payload: unknown): {
  valid: boolean;
  error?: AppError;
} {
  const size = new Blob([JSON.stringify(payload ?? '')]).size;
  if (size > MAX_MESSAGE_PAYLOAD_BYTES) {
    return {
      valid: false,
      error: createError(
        'INVALID_INPUT',
        `Message payload exceeds ${MAX_MESSAGE_PAYLOAD_BYTES} bytes`,
        false,
      ),
    };
  }
  return { valid: true };
}

/**
 * Send a typed message to the background service worker.
 * Used by content scripts, popup, side panel, and dashboard.
 */
export async function sendMessage<TResponse>(
  type: string,
  payload: unknown = null,
  options?: { tabId?: number },
): Promise<TResponse> {
  const envelope: MessageEnvelope = {
    protocolVersion: 1,
    type,
    requestId: crypto.randomUUID(),
    tabId: options?.tabId,
    occurredAt: new Date().toISOString(),
    payload,
  };

  const sizeCheck = validatePayloadSize(payload);
  if (!sizeCheck.valid) {
    throw sizeCheck.error;
  }

  const response = await chrome.runtime.sendMessage(envelope);
  return response as TResponse;
}

/**
 * Send a message to a specific tab (e.g., content script).
 * Used by background to deliver progress/results.
 */
export async function sendMessageToTab<TResponse>(
  tabId: number,
  type: string,
  payload: unknown = null,
): Promise<TResponse> {
  const envelope: MessageEnvelope = {
    protocolVersion: 1,
    type,
    requestId: crypto.randomUUID(),
    tabId,
    occurredAt: new Date().toISOString(),
    payload,
  };

  const response = await chrome.tabs.sendMessage(tabId, envelope);
  return response as TResponse;
}

/**
 * Map an unknown error to a stable AppError.
 * Never exposes internal details, credentials, or full response bodies.
 */
export function mapError(error: unknown): AppError {
  if (error && typeof error === 'object' && 'code' in error && 'userMessage' in error) {
    return error as AppError;
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case 'TimeoutError':
        return createError('TIMEOUT', 'The request timed out', true);
      case 'AbortError':
        return createError('CANCELLED', 'The request was cancelled', false);
      default:
        return createError('INTERNAL', 'An unexpected error occurred', false);
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('permission') || msg.includes('access')) {
      return createError('PERMISSION_DENIED', 'Permission denied', false);
    }
    if (msg.includes('not found') || msg.includes('404')) {
      return createError('NOT_FOUND', 'Resource not found', false);
    }
    if (msg.includes('conflict') || msg.includes('409')) {
      return createError('CONFLICT', 'Conflict with current state', true);
    }
    if (msg.includes('offline') || msg.includes('network')) {
      return createError('OFFLINE', 'Network is unavailable', true);
    }
  }

  return createError('INTERNAL', 'An unexpected error occurred', false);
}

/**
 * Get the current active tab. Returns null if no accessible tab.
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

/**
 * Get the current page session ref from the content script context.
 */
export function getCurrentPageSession(tabId: number): PageSessionRef {
  return {
    tabId,
    frameId: 0,
    documentId: crypto.randomUUID(),
    urlAtCapture: window.location.href.split('#')[0],
  };
}
