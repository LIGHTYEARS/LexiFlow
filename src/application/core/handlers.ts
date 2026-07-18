import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import { getSitePolicyView, getSettings } from '@infra/storage/settings-gateway';
import {
  deriveOriginPattern,
  hasPageAccess,
  requestPageAccess,
  removePageAccess,
  isSupportedPage,
  injectContentScriptIntoTab,
} from '@infra/permissions/page-access-policy';

/**
 * Register all M1 message handlers.
 * Called from the background service worker.
 */
export function registerCoreHandlers(): void {
  // ── Settings: site policy query ──
  messageRegistry.register('settings/site-policy', async (payload, envelope) => {
    const { origin } = payload as { origin: string };
    if (!origin) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Origin required', false));
    }
    const policy = await getSitePolicyView(origin);
    return ok(envelope.requestId, policy);
  });

  // ── Settings: get all settings (trusted contexts only) ──
  messageRegistry.register('settings/get', async (_payload, envelope, sender) => {
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
        ...settings.model,
        hasCredential: settings.model.credentialRef ? true : false,
      },
    });
  });

  // ── Page access: enable current site ──
  messageRegistry.register('page/enable-site', async (payload, envelope) => {
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
  messageRegistry.register('page/disable-site', async (payload, envelope) => {
    const { url } = payload as { url: string };
    const originPattern = deriveOriginPattern(url);
    if (!originPattern) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid URL', false));
    }

    const result = await removePageAccess(originPattern);
    return ok(envelope.requestId, { removed: result.removed });
  });

  // ── Page access: check if site is enabled ──
  messageRegistry.register('page/check-access', async (payload, envelope) => {
    const { url } = payload as { url: string };
    const originPattern = deriveOriginPattern(url);
    if (!originPattern) {
      return ok(envelope.requestId, { enabled: false });
    }
    const enabled = await hasPageAccess(originPattern);
    return ok(envelope.requestId, { enabled });
  });

  // ── Navigation: open extension page ──
  messageRegistry.register('navigation/open', async (payload, envelope) => {
    const { destination } = payload as { destination: string; tabId?: number };

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

    return ok(envelope.requestId, undefined as unknown);
  });

  // ── Dashboard: get counts (placeholder — real implementation in M5-M7) ──
  messageRegistry.register('dashboard/counts', async (_payload, envelope) => {
    // Placeholder counts — real queries come from repository in later milestones
    return ok(envelope.requestId, {
      todayDue: 0,
      overdue: 0,
      inbox: 0,
      newThisWeek: 0,
    });
  });

  // ── Page summary (placeholder — real implementation in M6) ──
  messageRegistry.register('page/summary', async (payload, envelope) => {
    const { url } = payload as { url?: string };
    return ok(envelope.requestId, {
      pageId: '',
      url: url || '',
      title: '',
      cardCount: 0,
      inboxCount: 0,
    });
  });
}
