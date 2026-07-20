/**
 * Date/time utilities for consistent ISO 8601 UTC handling.
 * All persisted times are ISO 8601 UTC strings.
 * Display conversion happens in the UI layer.
 */

/**
 * Get current time as ISO 8601 UTC string.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parse an ISO date string. Returns null if invalid.
 */
export function parseIso(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Check if a date is in the past (due).
 */
export function isDue(iso: string): boolean {
  const d = parseIso(iso);
  if (!d) throw new Error('Invalid ISO date string: ' + iso);
  return d.getTime() <= Date.now();
}

/**
 * Get the start of today in the user's timezone, as an ISO string.
 * Used for review queue date boundaries.
 */
export function startOfTodayIso(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
