/**
 * URL utilities for canonicalization and validation.
 * See technical-design/04 §5.2 and technical-design/11 §5.
 */

/**
 * Parse and validate a URL. Returns null if invalid.
 */
export function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Compute a canonical key for a SourcePage URL.
 * - Removes fragment
 * - Normalizes host (lowercase)
 * - Removes default port
 * - Preserves query by default (only known tracking params removed)
 * See technical-design/04 §5.2.
 */
export function canonicalizeUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error('Cannot canonicalize invalid URL: ' + url);

  // Remove fragment
  parsed.hash = '';

  // Remove default ports
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Host is already lowercase by URL API, but ensure
  parsed.hostname = parsed.hostname.toLowerCase();

  return parsed.toString();
}

/**
 * Extract the origin (protocol + host + port) from a URL.
 * Used for permission requests. See technical-design/02 §4.1.
 */
export function getOrigin(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  return parsed.origin;
}

/**
 * Validate that a URL uses http or https scheme.
 * See technical-design/11 §3.
 */
export function isHttpUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Remove fragment from a URL (for provenance display).
 */
export function removeFragment(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) throw new Error('Cannot remove fragment from invalid URL: ' + url);
  parsed.hash = '';
  return parsed.toString();
}
