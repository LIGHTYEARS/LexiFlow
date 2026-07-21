import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import {
  getSitePolicyView,
  getSettings,
  updateSettings,
  saveCredential,
} from '@infra/storage/settings-gateway';
import type { UserSettings } from '@infra/storage/settings-schema';
import { saveCaptureTransaction } from '@infra/db/transactions';
import type { SaveCaptureInput } from '@infra/db/transactions';
import {
  deriveOriginPattern,
  hasPageAccess,
  requestPageAccess,
  removePageAccess,
  isSupportedPage,
  injectContentScriptIntoTab,
} from '@infra/permissions/page-access-policy';
import {
  validateModelBaseUrl,
  requestModelAccess,
} from '@infra/permissions/model-origin-gateway';
import type {
  SitePolicyQuery,
  SitePolicyView,
  UserSettingsView,
  OpenDestinationCommand,
  DashboardCounts,
  PageSummaryQuery,
  PageSummary,
} from '@shared/protocol/protocol-map';

/**
 * Register all M1 message handlers.
 * Called from the background service worker.
 */
export function registerCoreHandlers(): void {
  // ── Settings: site policy query ──
  messageRegistry.register<SitePolicyQuery, SitePolicyView>('settings/site-policy', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('origin' in payload) || typeof (payload as any).origin !== 'string') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { origin } = payload as { origin: string };
    if (!origin) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Origin required', false));
    }
    const policy = await getSitePolicyView(origin);
    return ok(envelope.requestId, policy);
  });

  // ── Settings: get all settings (trusted contexts only) ──
  messageRegistry.register<unknown, UserSettingsView>('settings/get', async (_payload: unknown, envelope, sender) => {
    // Only allow from extension pages (not content scripts)
    if (sender.tab && sender.url?.startsWith('http')) {
      return fail(
        envelope.requestId,
        createError('PERMISSION_DENIED', 'Settings not available to content scripts', false),
      );
    }
    const settings = await getSettings();
    // Never return credential value, only whether it's set
    return ok(envelope.requestId, {
      ...settings,
      model: {
        baseUrl: settings.model.baseUrl,
        hasCredential: !!settings.model.credentialRef,
        taskModels: settings.model.taskModels,
      },
    });
  });

  // ── Settings: update (partial patch) ──
  messageRegistry.register<{ patch: Partial<UserSettings> }, { updated: boolean }>(
    'settings/update',
    async (payload: unknown, envelope, sender) => {
      // Only allow from extension pages (not content scripts)
      if (sender.tab && sender.url?.startsWith('http')) {
        return fail(
          envelope.requestId,
          createError('PERMISSION_DENIED', 'Settings not available to content scripts', false),
        );
      }
      if (!payload || typeof payload !== 'object' || !('patch' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const { patch } = payload as { patch: Partial<UserSettings> };
      const result = await updateSettings(patch);
      if (!result.success) {
        return fail(envelope.requestId, result.error || createError('STORAGE_FAILURE', 'Failed to update settings', true));
      }
      return ok(envelope.requestId, { updated: true });
    },
  );

  // ── Settings: save credential (API key) ──
  messageRegistry.register<{ type: 'litellm-api-key'; value: string }, { success: boolean; credentialRef?: string }>(
    'settings/saveCredential',
    async (payload: unknown, envelope, sender) => {
      if (sender.tab && sender.url?.startsWith('http')) {
        return fail(
          envelope.requestId,
          createError('PERMISSION_DENIED', 'Credentials not available to content scripts', false),
        );
      }
      if (!payload || typeof payload !== 'object' || !('value' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const { type, value } = payload as { type: 'litellm-api-key'; value: string };
      const result = await saveCredential(type, value);
      if (!result.success) {
        return fail(envelope.requestId, result.error || createError('STORAGE_FAILURE', 'Failed to save credential', true));
      }
      return ok(envelope.requestId, { success: true, credentialRef: result.credentialRef });
    },
  );

  // ── Settings: request model origin permission ──
  // Must be called from a user gesture (click on "Save" or "Test Connection").
  messageRegistry.register<{ baseUrl: string }, { granted: boolean; originPattern?: string }>(
    'settings/requestModelAccess',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('baseUrl' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const { baseUrl } = payload as { baseUrl: string };

      // Validate the base URL
      const validation = validateModelBaseUrl(baseUrl);
      if (!validation.valid) {
        return fail(envelope.requestId, validation.error);
      }

      // Request Chrome host permission for the origin
      const originPattern = `${validation.origin}/*`;
      const result = await requestModelAccess(originPattern);
      return ok(envelope.requestId, result);
    },
  );

  // ── Page access: enable current site ──
  messageRegistry.register<{ url: string; tabId?: number }, { granted: boolean; originPattern: string }>('page/enable-site', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as any).url !== 'string') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { url, tabId } = payload as { url: string; tabId?: number };
    if (!url || !isSupportedPage(url)) {
      return fail(
        envelope.requestId,
        createError('INVALID_INPUT', 'Unsupported page type', false),
      );
    }

    const originPattern = deriveOriginPattern(url);
    if (!originPattern) {
      return fail(
        envelope.requestId,
        createError('INVALID_INPUT', 'Cannot derive origin from URL', false),
      );
    }

    const result = await requestPageAccess(originPattern);
    if (!result.granted) {
      return fail(envelope.requestId, result.error || createError('PERMISSION_DENIED', 'Permission not granted', false));
    }

    // Inject content script into the current tab if provided
    if (tabId) {
      await injectContentScriptIntoTab(tabId);
    }

    return ok(envelope.requestId, { granted: true, originPattern });
  });

  // ── Page access: disable current site ──
  messageRegistry.register<{ url: string }, { removed: boolean }>('page/disable-site', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as any).url !== 'string') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { url } = payload as { url: string };
    const originPattern = deriveOriginPattern(url);
    if (!originPattern) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid URL', false));
    }

    const result = await removePageAccess(originPattern);
    return ok(envelope.requestId, { removed: result.removed });
  });

  // ── Page access: check if site is enabled ──
  messageRegistry.register<{ url: string }, { enabled: boolean }>('page/check-access', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as any).url !== 'string') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { url } = payload as { url: string };
    const originPattern = deriveOriginPattern(url);
    if (!originPattern) {
      return ok(envelope.requestId, { enabled: false });
    }
    const enabled = await hasPageAccess(originPattern);
    return ok(envelope.requestId, { enabled });
  });

  // ── Navigation: open extension page ──
  messageRegistry.register<OpenDestinationCommand, void>('navigation/open', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('destination' in payload) || typeof (payload as any).destination !== 'string') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { destination } = payload as { destination: 'dashboard' | 'review' | 'inbox' | 'settings'; tabId?: number };

    const validDestinations = ['dashboard', 'review', 'inbox', 'settings'];
    if (!validDestinations.includes(destination)) {
      return fail(
        envelope.requestId,
        createError('INVALID_INPUT', 'Invalid navigation destination', false),
      );
    }

    // Open the dashboard with the appropriate route
    const dashboardUrl = chrome.runtime.getURL(`dashboard.html#/${destination}`);
    await chrome.tabs.create({ url: dashboardUrl });

    return ok(envelope.requestId, undefined);
  });

  // ── Dashboard: get counts (placeholder — real implementation in M5-M7) ──
  messageRegistry.register<unknown, DashboardCounts>('dashboard/counts', async (_payload: unknown, envelope) => {
    // Placeholder counts — real queries come from repository in later milestones
    return ok(envelope.requestId, {
      todayDue: 0,
      overdue: 0,
      inbox: 0,
      newThisWeek: 0,
    });
  });

  // ── Page summary (placeholder — real implementation in M6) ──
  messageRegistry.register<PageSummaryQuery, PageSummary>('page/summary', async (payload: unknown, envelope) => {
    const { pageUrl } = payload as { pageUrl?: string };
    return ok(envelope.requestId, {
      pageId: '',
      pageUrl: pageUrl || '',
      title: '',
      cardCount: 0,
      inboxCount: 0,
    });
  });

  // ── Capture: save selection as card or to inbox ──
  messageRegistry.register<SaveCaptureInput & { idempotencyKey?: string }, {
    captureId: string;
    status: string;
    cardId?: string;
    message: string;
  }>('capture/save', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as SaveCaptureInput;
    if (!input.selectedText || !input.pageUrl) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Missing required fields', false));
    }
    try {
      const result = await saveCaptureTransaction(input);
      return ok(envelope.requestId, result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Save failed';
      return fail(envelope.requestId, createError('INTERNAL', msg, false));
    }
  });
}
