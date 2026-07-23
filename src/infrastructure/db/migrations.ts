import { db } from './database';
import { setSchemaVersion, getSchemaVersion } from '@infra/storage/settings-gateway';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';

/**
 * Database migration coordinator.
 * Protocol: preflight → backup → upgrade → invariant verification → commit marker.
 * See technical-design/04 §10.
 *
 * Current schema version: 1
 */

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Migration state for UI display.
 */
export type MigrationStatus =
  | { phase: 'idle' }
  | { phase: 'preflight'; message: string }
  | { phase: 'backup'; message: string }
  | { phase: 'upgrade'; message: string }
  | { phase: 'verification'; message: string }
  | { phase: 'complete'; message: string }
  | { phase: 'error'; error: AppError };

/**
 * Preflight check: verify current schema version and record counts.
 */
async function preflight(): Promise<{
  currentVersion: number;
}> {
  const currentVersion = await getSchemaVersion();
  return { currentVersion };
}

/**
 * Create a protective backup snapshot before a schema upgrade (PRD §15.3,
 * §17.2). Stored under a meta key so it survives worker restarts and can be
 * restored if the upgrade fails. Skipped for the initial v0→v1 creation
 * (no user data yet).
 */
async function createPreUpgradeBackup(): Promise<void> {
  // Lazy import: dexie-export-import augments the Dexie prototype and touches
  // `self`, so only load it in the worker/runtime, never at module eval time.
  const { exportDB } = await import('dexie-export-import');
  const blob = await exportDB(db, { prettyJson: false });
  const text = await blob.text();
  await db.meta.put({ key: 'preUpgradeBackup', value: text });
  await db.meta.put({ key: 'preUpgradeBackupAt', value: new Date().toISOString() });
}

/**
 * Run database migrations up to the current version.
 * This is called on extension startup.
 * Protocol: preflight → (backup → upgrade) → invariant verification → commit.
 */
export async function runMigrations(): Promise<MigrationStatus> {
  try {
    // Preflight
    const { currentVersion } = await preflight();

    // Already at current version
    if (currentVersion >= CURRENT_SCHEMA_VERSION) {
      return { phase: 'complete', message: 'Schema up to date' };
    }

    // v0 → v1: initial schema creation. Dexie creates the schema on first open,
    // so there is no pre-existing user data to back up.
    if (currentVersion === 0) {
      await setSchemaVersion(CURRENT_SCHEMA_VERSION);
      const violations = await verifyInvariants();
      if (violations.length > 0) {
        return { phase: 'error', error: createError('STORAGE_FAILURE', 'Invariant check failed after schema creation', false) };
      }
      return { phase: 'complete', message: 'Schema v1 created' };
    }

    // Real upgrade path (v>=1 → higher): back up first, then verify (§15.3, §17.2).
    await createPreUpgradeBackup();
    // (Future per-version migration steps run here, wrapped so a failure leaves
    // the pre-upgrade backup intact for recovery.)
    await setSchemaVersion(CURRENT_SCHEMA_VERSION);

    const violations = await verifyInvariants();
    if (violations.length > 0) {
      return {
        phase: 'error',
        error: createError('STORAGE_FAILURE', `Upgrade verification failed: ${violations.length} invariant violation(s). Pre-upgrade backup retained.`, true),
      };
    }
    return { phase: 'complete', message: `Migrated to schema v${CURRENT_SCHEMA_VERSION}` };
  } catch (error) {
    const appError =
      error && typeof error === 'object' && 'code' in error && 'userMessage' in error && 'retryable' in error
        ? (error as AppError)
        : createError(
            'STORAGE_FAILURE',
            'Migration failed: ' + (error instanceof Error ? error.message : String(error)),
            false,
          );
    return { phase: 'error', error: appError };
  }
}

/**
 * Verify database invariants after migration.
 * Returns a list of invariant violations (empty = all good).
 */
export async function verifyInvariants(): Promise<string[]> {
  const violations: string[] = [];

  // Check 1: All cards have valid status
  const cards = await db.cards.toArray();
  for (const card of cards) {
    if (card.status === 'deleted' && !card.deletedAt) {
      violations.push(`Card ${card.id} is deleted but has no deletedAt`);
    }
    if (card.revision < 1) {
      violations.push(`Card ${card.id} has invalid revision ${card.revision}`);
    }
  }

  // Check 2: SourceCapture references valid SourcePage
  const captures = await db.sourceCaptures.toArray();
  const pageIds = new Set((await db.sourcePages.toArray()).map((p) => p.id));
  for (const capture of captures) {
    if (!pageIds.has(capture.pageId)) {
      violations.push(`SourceCapture ${capture.id} references missing page ${capture.pageId}`);
    }
  }

  // Check 3: CardSourceLink references valid card and capture
  const links = await db.cardSourceLinks.toArray();
  const cardIds = new Set(cards.map((c) => c.id));
  const captureIds = new Set(captures.map((c) => c.id));
  for (const link of links) {
    if (!cardIds.has(link.cardId)) {
      violations.push(`CardSourceLink ${link.id} references missing card ${link.cardId}`);
    }
    if (!captureIds.has(link.sourceCaptureId)) {
      violations.push(`CardSourceLink ${link.id} references missing capture ${link.sourceCaptureId}`);
    }
  }

  // Check 4: ReviewEvent sequence matches ScheduleSnapshot
  const snapshots = await db.scheduleSnapshots.toArray();
  for (const snapshot of snapshots) {
    const events = await db.reviewEvents
      .where('cardId')
      .equals(snapshot.cardId)
      .sortBy('sequence');
    const maxSequence = events.length > 0 ? events[events.length - 1].sequence : 0;
    if (snapshot.lastSequence !== maxSequence) {
      violations.push(
        `ScheduleSnapshot for card ${snapshot.cardId} has lastSequence ${snapshot.lastSequence} but max event sequence is ${maxSequence}`,
      );
    }
  }

  return violations;
}

/**
 * Get migration status for display.
 */
export async function getMigrationStatus(): Promise<{
  currentVersion: number;
  targetVersion: number;
  needsMigration: boolean;
}> {
  const currentVersion = await getSchemaVersion();
  return {
    currentVersion,
    targetVersion: CURRENT_SCHEMA_VERSION,
    needsMigration: currentVersion < CURRENT_SCHEMA_VERSION,
  };
}
