import { db } from '@infra/db/database';
import { exportDB, importInto } from 'dexie-export-import';
import { nowIso } from '@shared/utils/date';
import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';

/**
 * BackupService — handles full backup/restore, CSV/Markdown export, and data clearing.
 * See PRD §15 and technical-design/10.
 */

/**
 * Export a full backup as a Blob (JSON format from dexie-export-import).
 * Excludes credentials (stored separately in chrome.storage, not in Dexie).
 */
export async function exportFullBackup(): Promise<Blob> {
  const blob = await exportDB(db, {
    prettyJson: true,
  });
  return blob;
}

/**
 * Import a full backup from a Blob.
 * Non-destructive: existing data is preserved unless the user explicitly chooses to replace.
 * Returns a summary of what was imported.
 */
export async function importFullBackup(
  blob: Blob,
  options: { replace?: boolean } = {},
): Promise<{ tables: string[]; recordCount: number }> {
  // Import into the existing database
  await importInto(db, blob, {
    overwriteValues: options.replace || false,
    clearTablesBeforeImport: options.replace || false,
    acceptVersionDiff: true,
    acceptNameDiff: true,
  });

  // Count records after import
  const tables = db.tables.map((t) => t.name);
  let recordCount = 0;
  for (const table of db.tables) {
    recordCount += await table.count();
  }

  return { tables, recordCount };
}

/**
 * Preview a backup file without importing.
 * Returns the table names and approximate record counts.
 */
export async function previewBackup(blob: Blob): Promise<{ tables: string[]; recordCount: number }> {
  // Read the JSON to get table structure
  const text = await blob.text();
  try {
    const data = JSON.parse(text);
    const tables = Object.keys(data.data || {});
    let recordCount = 0;
    for (const table of tables) {
      recordCount += (data.data[table] || []).length;
    }
    return { tables, recordCount };
  } catch {
    throw createError('INVALID_INPUT', 'Invalid backup file format', false);
  }
}

/**
 * Export cards as CSV.
 */
export async function exportCsv(): Promise<string> {
  const cards = await db.cards.toArray();
  const headers = ['id', 'type', 'headword', 'status', 'explanations', 'examples', 'createdAt', 'updatedAt'];
  const rows = cards.map((card) => [
    card.id,
    card.type,
    card.headword.value,
    card.status,
    card.explanations.map((e) => e.value).join('; '),
    card.examples.map((e) => e.value).join('; '),
    card.createdAt,
    card.updatedAt,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return csv;
}

/**
 * Export cards as Markdown.
 */
export async function exportMarkdown(): Promise<string> {
  const cards = await db.cards.toArray();
  const sections = cards.map((card) => {
    const lines: string[] = [];
    lines.push(`## ${card.headword.value}`);
    lines.push('');
    lines.push(`**Type:** ${card.type} | **Status:** ${card.status}`);
    lines.push('');
    if (card.explanations.length > 0) {
      lines.push('### Explanations');
      card.explanations.forEach((e) => lines.push(`- ${e.value}`));
      lines.push('');
    }
    if (card.examples.length > 0) {
      lines.push('### Examples');
      card.examples.forEach((e) => lines.push(`> ${e.value}`));
      lines.push('');
    }
    lines.push(`*Created: ${new Date(card.createdAt).toLocaleDateString()}*`);
    lines.push('');
    lines.push('---');
    lines.push('');
    return lines.join('\n');
  });

  return `# LexiFlow Knowledge Base\n\nExported: ${new Date().toISOString()}\n\n${sections.join('\n')}`;
}

/**
 * Clear all data from the database.
 * Requires explicit confirmation (handled at UI layer).
 */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
}

/**
 * Clear all Inbox items.
 */
export async function clearInbox(): Promise<number> {
  const count = await db.inboxItems.count();
  await db.inboxItems.clear();
  return count;
}

/**
 * Get local storage size estimate.
 */
export async function getStorageSize(): Promise<{ usedBytes: number; quotaBytes: number | null }> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usedBytes: estimate.usage || 0,
        quotaBytes: estimate.quota ?? null,
      };
    }
  } catch {
    // Fallback: estimate from IndexedDB
  }
  return { usedBytes: 0, quotaBytes: null };
}

export type { AppError };
