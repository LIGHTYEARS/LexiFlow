import { exportDB, peakImportFile, importInto } from 'dexie-export-import';
import { db } from '@infra/db/database';
import { getSchemaVersion } from '@infra/storage/settings-gateway';
import { nowIso } from '@shared/utils/date';

/**
 * BackupService — full backup export, import preview + protected import, and
 * clear operations (PRD §15.2-15.4, §14.5, §20.1). Credentials live in
 * chrome.storage.local (not IndexedDB) and are therefore never included in a
 * Dexie backup (§15.1).
 *
 * dexie-export-import augments the Dexie prototype at import time; here we use
 * the functional API for explicit control.
 */

export interface BackupManifest {
  format: 'lexiflow-backup';
  version: number;
  schemaVersion: number;
  createdAt: string;
}

/**
 * Produce a full backup as a JSON string (base64-free, structured).
 * Returns both the manifest and the Dexie export blob text so the UI can
 * offer a download.
 */
export async function exportFullBackup(): Promise<{ manifest: BackupManifest; data: string }> {
  const blob = await exportDB(db, { prettyJson: false });
  const data = await blob.text();
  const manifest: BackupManifest = {
    format: 'lexiflow-backup',
    version: 1,
    schemaVersion: await getSchemaVersion(),
    createdAt: nowIso(),
  };
  return { manifest, data };
}

/**
 * Preview an import file WITHOUT applying it (§15.3): returns table row counts
 * and the source database name so the UI can show what will change.
 */
export async function previewImport(data: string): Promise<{
  databaseName: string;
  tables: Array<{ name: string; rowCount: number }>;
}> {
  const blob = new Blob([data], { type: 'application/json' });
  const meta = await peakImportFile(blob);
  return {
    databaseName: meta.data.databaseName,
    tables: meta.data.tables.map((t) => ({ name: t.name, rowCount: t.rowCount })),
  };
}

/**
 * Import a backup with a protective auto-backup first (§15.3). By default this
 * clears existing tables and replaces them (overwrite is explicit, never
 * silent — the caller must have shown the preview + confirmed).
 *
 * On failure the protective backup is returned so the caller can restore.
 */
export async function importBackup(
  data: string,
  options: { mode: 'replace' | 'merge' },
): Promise<{ imported: boolean; protectiveBackup: string }> {
  // 1. Protective backup of current data.
  const protective = await exportDB(db, { prettyJson: false });
  const protectiveText = await protective.text();

  try {
    const blob = new Blob([data], { type: 'application/json' });
    if (options.mode === 'replace') {
      await clearAllTables();
    }
    await importInto(db, blob, {
      acceptNameDiff: true,
      acceptVersionDiff: true,
      clearTablesBeforeImport: options.mode === 'replace',
      overwriteValues: options.mode === 'replace',
    });
    return { imported: true, protectiveBackup: protectiveText };
  } catch (error) {
    // Attempt to restore the protective backup so we never leave partial data.
    try {
      await clearAllTables();
      await importInto(db, new Blob([protectiveText], { type: 'application/json' }), {
        acceptNameDiff: true,
        acceptVersionDiff: true,
        clearTablesBeforeImport: true,
        overwriteValues: true,
      });
    } catch {
      // Restore failed; surface the protective backup for manual recovery.
    }
    throw error;
  }
}

async function clearAllTables(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

/**
 * Clear the Inbox (pending items only). Confirmation enforced at handler layer.
 */
export async function clearInbox(): Promise<{ cleared: number }> {
  const pending = await db.inboxItems.where('status').anyOf(['pending', 'processing']).toArray();
  await db.inboxItems.bulkDelete(pending.map((i) => i.id));
  return { cleared: pending.length };
}

/**
 * Clear ALL data. Confirmation + backup prompt enforced at handler layer (§14.5).
 */
export async function clearAllData(): Promise<{ cleared: true }> {
  await clearAllTables();
  return { cleared: true };
}

/**
 * CSV export of cards (readable/portable, not a full backup — §15.2).
 */
export async function exportCardsCsv(): Promise<string> {
  const cards = await db.cards.filter((c) => c.status !== 'deleted').toArray();
  const header = ['id', 'type', 'status', 'headword', 'explanation', 'example', 'createdAt'];
  const rows = cards.map((c) => [
    c.id,
    c.type,
    c.status,
    csvCell(c.headword.value),
    csvCell(c.explanations[0]?.value ?? ''),
    csvCell(c.examples[0]?.value ?? ''),
    c.createdAt,
  ]);
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Markdown export of cards (readable — §15.2).
 */
export async function exportCardsMarkdown(): Promise<string> {
  const cards = await db.cards.filter((c) => c.status !== 'deleted').toArray();
  const lines: string[] = ['# LexiFlow Cards', ''];
  for (const c of cards) {
    lines.push(`## ${c.headword.value} _(${c.type})_`);
    if (c.explanations[0]) lines.push(c.explanations[0].value);
    for (const ex of c.examples) lines.push(`- ${ex.value}`);
    lines.push('');
  }
  return lines.join('\n');
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}
