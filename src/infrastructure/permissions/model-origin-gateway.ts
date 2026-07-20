import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';

/**
 * ModelOriginPermissionGateway — manages authorization for LiteLLM service origins.
 * This is SEPARATE from page access — it controls where AI requests can be sent.
 * See technical-design/02 §4.1 and technical-design/11 §3.
 */

/**
 * Validate and normalize a LiteLLM base URL.
 * Allows https://host[:port][/path-prefix] and explicitly-confirmed localhost http.
 * Rejects userinfo, query, fragment, and non-http(s) schemes.
 */
export function validateModelBaseUrl(url: string):
  | { valid: true; origin: string }
  | { valid: false; error: AppError } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      valid: false,
      error: createError('INVALID_INPUT', 'Invalid URL format', false),
    };
  }

  // Reject userinfo (e.g., https://user:pass@host)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: createError('INVALID_INPUT', 'URL must not contain credentials', false),
    };
  }

  // Reject query and fragment in base URL
  if (parsed.search || parsed.hash) {
    return {
      valid: false,
      error: createError('INVALID_INPUT', 'Base URL must not contain query or fragment', false),
    };
  }

  // Allow http for localhost only (explicit confirmation needed in UI)
  if (parsed.protocol === 'http:') {
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return {
        valid: false,
        error: createError(
          'INVALID_INPUT',
          'HTTP is only allowed for localhost. Use HTTPS for remote services.',
          false,
        ),
      };
    }
  } else if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: createError('INVALID_INPUT', 'Only HTTP(S) URLs are allowed', false),
    };
  }

  // Origin = protocol + host + port (no path)
  const origin = `${parsed.protocol}//${parsed.host}`;
  return { valid: true, origin };
}

/**
 * Derive the Chrome permission origin pattern from a model base URL.
 * Returns the origin pattern (e.g., "https://api.example.com/*") or null.
 */
export function deriveModelOriginPattern(baseUrl: string): string | null {
  const validation = validateModelBaseUrl(baseUrl);
  if (!validation.valid) return null;
  return `${validation.origin}/*`;
}

/**
 * Check if the extension has permission for the model origin.
 */
export async function hasModelAccess(originPattern: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch {
    return false;
  }
}

/**
 * Request model origin permission.
 * Must be called from a user gesture (click on "Test Connection" or "Save").
 */
export async function requestModelAccess(
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
        'Failed to request model service permission',
        false,
      ),
    };
  }
}

/**
 * Remove model origin permission.
 */
export async function removeModelAccess(
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
 * Check if a model request can be made to the given base URL.
 * Combines URL validation and permission check.
 */
export async function canMakeModelRequest(baseUrl: string): Promise<
  | { allowed: true }
  | { allowed: false; error: AppError }
> {
  const validation = validateModelBaseUrl(baseUrl);
  if (!validation.valid) {
    return { allowed: false, error: validation.error };
  }

  const originPattern = `${validation.origin}/*`;
  const hasPermission = await hasModelAccess(originPattern);

  if (!hasPermission) {
    return {
      allowed: false,
      error: createError(
        'PERMISSION_DENIED',
        'Model service origin not authorized. Please grant permission in Settings.',
        false,
      ),
    };
  }

  return { allowed: true };
}
