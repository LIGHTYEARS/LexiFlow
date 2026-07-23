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
  registerContentScriptsForOrigins,
  getAuthorizedOrigins,
} from '@infra/permissions/page-access-policy';
import {
  countInboxByStatus,
  countDueReviews,
} from '@infra/db/repository-impl';
import { db } from '@infra/db/database';
import { canonicalizeUrl } from '@shared/utils/url';
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
    if (!payload || typeof payload !== 'object' || !('origin' in payload) || typeof (payload as Record<string, unknown>).origin !== 'string') {
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
        taskPrompts: settings.model.taskPrompts,
        requestTimeoutMs: settings.model.requestTimeoutMs,
      },
    });
  });

  // ── Page access: enable current site ──
  messageRegistry.register<{ url: string; tabId?: number }, { granted: boolean; originPattern: string }>('page/enable-site', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as Record<string, unknown>).url !== 'string') {
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

  // ── Page access: register + inject after the popup granted permission ──
  // chrome.permissions.request must run in the popup's user-gesture context,
  // so the popup grants the origin itself and then calls this to register the
  // content script and inject it into the current tab (no page refresh needed).
  messageRegistry.register<{ url: string; tabId?: number }, { registered: boolean; originPattern: string }>(
    'page/register-site',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as Record<string, unknown>).url !== 'string') {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const { url, tabId } = payload as { url: string; tabId?: number };
      if (!url || !isSupportedPage(url)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Unsupported page type', false));
      }
      const originPattern = deriveOriginPattern(url);
      if (!originPattern) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Cannot derive origin from URL', false));
      }
      // The popup already holds the permission; verify then register + inject.
      const granted = await hasPageAccess(originPattern);
      if (!granted) {
        return fail(envelope.requestId, createError('PERMISSION_DENIED', 'Site not authorized', false));
      }
      const reg = await registerContentScriptsForOrigins(await getAuthorizedOrigins());
      let injectErr: string | undefined;
      if (tabId) {
        const inj = await injectContentScriptIntoTab(tabId);
        injectErr = inj.error;
      }
      // Surface any registration/injection error so the popup can display it.
      if (reg.error || injectErr) {
        return fail(
          envelope.requestId,
          createError('INTERNAL', `Injection failed: ${reg.error ?? ''} ${injectErr ?? ''}`.trim(), true),
        );
      }
      return ok(envelope.requestId, { registered: true, originPattern });
    },
  );

  // ── Page access: disable current site ──
  messageRegistry.register<{ url: string }, { removed: boolean }>('page/disable-site', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as Record<string, unknown>).url !== 'string') {
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
    if (!payload || typeof payload !== 'object' || !('url' in payload) || typeof (payload as Record<string, unknown>).url !== 'string') {
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
    if (!payload || typeof payload !== 'object' || !('destination' in payload) || typeof (payload as Record<string, unknown>).destination !== 'string') {
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

  // ── Dashboard: get counts (real repository queries) ──
  messageRegistry.register<unknown, DashboardCounts>('dashboard/counts', async (_payload: unknown, envelope) => {
    const [dueCounts, inboxCounts] = await Promise.all([countDueReviews(), countInboxByStatus()]);
    // New this week: cards created within the last 7 days.
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newThisWeek = await db.cards
      .filter((c) => c.status !== 'deleted' && c.createdAt >= weekAgo)
      .count();
    return ok(envelope.requestId, {
      todayDue: dueCounts.due + dueCounts.learning,
      overdue: dueCounts.overdue,
      inbox: inboxCounts.pending + inboxCounts.processing,
      newThisWeek,
    });
  });

  // ── Page summary (real repository query by canonical URL) ──
  messageRegistry.register<PageSummaryQuery, PageSummary>('page/summary', async (payload: unknown, envelope) => {
    const { pageUrl } = (payload ?? {}) as { pageUrl?: string };
    if (!pageUrl) {
      return ok(envelope.requestId, { pageId: '', pageUrl: '', title: '', cardCount: 0, inboxCount: 0 });
    }
    let canonicalKey: string;
    try {
      canonicalKey = canonicalizeUrl(pageUrl);
    } catch {
      return ok(envelope.requestId, { pageId: '', pageUrl, title: '', cardCount: 0, inboxCount: 0 });
    }
    const page = await db.sourcePages.get({ canonicalKey });
    if (!page) {
      return ok(envelope.requestId, { pageId: '', pageUrl, title: '', cardCount: 0, inboxCount: 0 });
    }
    const captures = await db.sourceCaptures.where('pageId').equals(page.id).toArray();
    const captureIds = captures.map((c) => c.id);
    const links = captureIds.length
      ? await db.cardSourceLinks.where('sourceCaptureId').anyOf(captureIds).toArray()
      : [];
    const cardCount = new Set(links.map((l) => l.cardId)).size;
    const inboxCount = captureIds.length
      ? await db.inboxItems.where('sourceCaptureId').anyOf(captureIds).filter((i) => i.status === 'pending').count()
      : 0;
    return ok(envelope.requestId, {
      pageId: page.id,
      pageUrl: page.url,
      title: page.title,
      cardCount,
      inboxCount,
      lastCapturedAt: page.lastSeenAt,
    });
  });
}
