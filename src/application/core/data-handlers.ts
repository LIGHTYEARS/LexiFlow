import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { z } from 'zod';
import { parsePayload } from './validate-payload';
import * as backup from '@app/backup/backup-service';
import { updateSettings, saveCredential, getSettings, deleteCredential } from '@infra/storage/settings-gateway';
import { requireConfirmation, mintConfirmationToken } from '@app/safety/risk-policy';
import { UserSettingsSchema } from '@infra/storage/settings-schema';

/**
 * Data & settings handlers (PRD §14, §15). All destructive data operations are
 * gated by a confirmation token minted after the UI shows the impact (§14.5).
 * These handlers reject content-script senders (trusted contexts only).
 */

function trustedOnly(sender: chrome.runtime.MessageSender): boolean {
  return !(sender.tab && sender.url?.startsWith('http'));
}

export function registerDataHandlers(): void {
  // ── settings/update ──
  messageRegistry.register<unknown, { updated: boolean }>(
    'settings/update',
    async (payload, envelope, sender) => {
      if (!trustedOnly(sender)) {
        return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Not available to content scripts', false));
      }
      const parsed = parsePayload(z.object({ patch: UserSettingsSchema.deepPartial() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const result = await updateSettings(parsed.value.patch as never);
      if (!result.success) return fail(envelope.requestId, result.error!);
      return ok(envelope.requestId, { updated: true });
    },
  );

  // ── settings/setCredential ──
  messageRegistry.register<unknown, { credentialRef: string }>(
    'settings/setCredential',
    async (payload, envelope, sender) => {
      if (!trustedOnly(sender)) {
        return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Not available to content scripts', false));
      }
      const parsed = parsePayload(z.object({ apiKey: z.string().min(1) }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const result = await saveCredential('litellm-api-key', parsed.value.apiKey);
      if (!result.success || !result.credentialRef) return fail(envelope.requestId, result.error!);
      // Link the credentialRef into settings so the gateway can find it.
      await updateSettings({ model: { ...(await getSettings()).model, credentialRef: result.credentialRef } } as never);
      return ok(envelope.requestId, { credentialRef: result.credentialRef });
    },
  );

  messageRegistry.register<unknown, { removed: boolean }>(
    'settings/clearCredential',
    async (_payload, envelope, sender) => {
      if (!trustedOnly(sender)) {
        return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Not available to content scripts', false));
      }
      await deleteCredential();
      const s = await getSettings();
      await updateSettings({ model: { ...s.model, credentialRef: undefined } } as never);
      return ok(envelope.requestId, { removed: true });
    },
  );

  // ── data/exportBackup ──
  messageRegistry.register<unknown, { manifest: backup.BackupManifest; data: string }>(
    'data/exportBackup',
    async (_payload, envelope, sender) => {
      if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
      const result = await backup.exportFullBackup();
      return ok(envelope.requestId, result);
    },
  );

  // ── data/exportCsv / data/exportMarkdown ──
  messageRegistry.register<unknown, { csv: string }>('data/exportCsv', async (_p, envelope, sender) => {
    if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
    return ok(envelope.requestId, { csv: await backup.exportCardsCsv() });
  });
  messageRegistry.register<unknown, { markdown: string }>('data/exportMarkdown', async (_p, envelope, sender) => {
    if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
    return ok(envelope.requestId, { markdown: await backup.exportCardsMarkdown() });
  });

  // ── data/previewImport ──
  messageRegistry.register<unknown, { databaseName: string; tables: Array<{ name: string; rowCount: number }>; confirmationToken: string }>(
    'data/previewImport',
    async (payload, envelope, sender) => {
      if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
      const parsed = parsePayload(z.object({ data: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      try {
        const preview = await backup.previewImport(parsed.value.data);
        const token = mintConfirmationToken('data.import', String(preview.tables.length));
        return ok(envelope.requestId, { ...preview, confirmationToken: token });
      } catch {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Not a valid backup file', false));
      }
    },
  );

  // ── data/import (requires confirmation from preview) ──
  messageRegistry.register<unknown, { imported: boolean }>(
    'data/import',
    async (payload, envelope, sender) => {
      if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
      const parsed = parsePayload(
        z.object({
          data: z.string(),
          mode: z.enum(['replace', 'merge']),
          tableCount: z.number(),
          confirmationToken: z.string(),
        }),
        payload,
        envelope,
      );
      if (!parsed.ok) return parsed.result;
      try {
        requireConfirmation('data.import', String(parsed.value.tableCount), parsed.value.confirmationToken);
        const result = await backup.importBackup(parsed.value.data, { mode: parsed.value.mode });
        return ok(envelope.requestId, { imported: result.imported });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('STORAGE_FAILURE', 'Import failed; existing data preserved', true));
      }
    },
  );

  // ── data/clearInbox (confirm) ──
  messageRegistry.register<unknown, { cleared: number }>(
    'data/clearInbox',
    async (payload, envelope, sender) => {
      if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
      const parsed = parsePayload(z.object({ confirmationToken: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      try {
        requireConfirmation('data.clear-inbox', 'clear-inbox', parsed.value.confirmationToken);
        return ok(envelope.requestId, await backup.clearInbox());
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('INTERNAL', 'Clear failed', true));
      }
    },
  );

  // ── data/clearAll (confirm) ──
  messageRegistry.register<unknown, { cleared: true }>(
    'data/clearAll',
    async (payload, envelope, sender) => {
      if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
      const parsed = parsePayload(z.object({ confirmationToken: z.string() }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      try {
        requireConfirmation('data.clear-all', 'clear-all', parsed.value.confirmationToken);
        return ok(envelope.requestId, await backup.clearAllData());
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) return fail(envelope.requestId, error as never);
        return fail(envelope.requestId, createError('INTERNAL', 'Clear failed', true));
      }
    },
  );

  // ── data/mintConfirmation: generic confirm-token minting for clear ops ──
  messageRegistry.register<unknown, { token: string }>(
    'data/mintConfirmation',
    (payload, envelope, sender) => {
      if (!trustedOnly(sender)) return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Trusted only', false));
      const parsed = parsePayload(z.object({ operation: z.enum(['data.clear-inbox', 'data.clear-all']) }), payload, envelope);
      if (!parsed.ok) return parsed.result;
      const sig = parsed.value.operation === 'data.clear-inbox' ? 'clear-inbox' : 'clear-all';
      return ok(envelope.requestId, { token: mintConfirmationToken(parsed.value.operation, sig) });
    },
  );
}
