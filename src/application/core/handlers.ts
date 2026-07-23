import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';
import {
  getSitePolicyView,
  getSettings,
  updateSettings,
  saveCredential,
  deleteCredential,
  hasCredential,
} from '@infra/storage/settings-gateway';
import {
  deriveOriginPattern,
  hasPageAccess,
  requestPageAccess,
  removePageAccess,
  isSupportedPage,
  injectContentScriptIntoTab,
} from '@infra/permissions/page-access-policy';
import { aiTaskCoordinator } from '@app/ai/task-coordinator';
import { testConnection } from '@adapters/llm-provider';
import { saveCaptureTransaction, createCardTransaction, appendSourceToCard } from '@infra/db/transactions';
import { db } from '@infra/db/database';
import {
  countDueReviews,
  countInboxByStatus,
  countCardsByStatus,
} from '@infra/db/repository-impl';
import { generateDedupPreview } from '@app/capture/dedup-service';
import {
  convertInboxToCard,
  appendInboxSourceToCard,
  discardInboxItem,
  getInboxItemsWithSource,
} from '@app/inbox/inbox-service';
import {
  createReviewSession,
  getNextReviewItem,
  revealAnswer,
  previewReviewRating,
  commitReviewRating,
} from '@app/review/review-service';
import { searchCards, rebuildSearchIndex } from '@app/search/search-service';
import {
  exportFullBackup,
  importFullBackup,
  exportCsv,
  exportMarkdown,
  clearAllData,
  clearInbox,
  getStorageSize,
} from '@app/backup/backup-service';
import type {
  SitePolicyQuery,
  SitePolicyView,
  UserSettingsView,
  OpenDestinationCommand,
  DashboardCounts,
  PageSummaryQuery,
  PageSummary,
  SettingsUpdateCommand,
  AiTaskRequest,
  AiTaskSnapshot,
  ConnectionTestResult,
  ExplainSelectionCommand,
  ExplainAccepted,
  SaveCaptureCommand,
  SaveCaptureResult,
  DedupPreview,
  ApplyDecisionCommand,
  InboxBatchPreviewCommand,
  InboxBatchApplyCommand,
  InboxBatchPreview,
  InboxBatchResult,
  CreateReviewSessionCommand,
  ReviewSession,
  ReviewItem,
  ReviewReveal,
  ReviewRating,
  RatingPreview,
  CommitRatingCommand,
  ReviewCommitResult,
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

  // ── Settings: update (trusted contexts only) ──
  messageRegistry.register<SettingsUpdateCommand, { updated: boolean }>('settings/update', async (payload: unknown, envelope, sender) => {
    if (sender.tab && sender.url?.startsWith('http')) {
      return fail(
        envelope.requestId,
        createError('PERMISSION_DENIED', 'Settings update not available to content scripts', false),
      );
    }
    if (!payload || typeof payload !== 'object' || !('patch' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { patch } = payload as { patch: Record<string, unknown> };
    if (!patch || typeof patch !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Patch must be an object', false));
    }

    const result = await updateSettings(patch as Parameters<typeof updateSettings>[0]);
    if (!result.success) {
      return fail(envelope.requestId, result.error || createError('INTERNAL', 'Failed to update settings', true));
    }
    return ok(envelope.requestId, { updated: true });
  });

  // ── Settings: save credential (trusted contexts only) ──
  messageRegistry.register<{ value: string }, { credentialRef: string }>('settings/save-credential', async (payload: unknown, envelope, sender) => {
    if (sender.tab && sender.url?.startsWith('http')) {
      return fail(
        envelope.requestId,
        createError('PERMISSION_DENIED', 'Credential save not available to content scripts', false),
      );
    }
    if (!payload || typeof payload !== 'object' || !('value' in payload) || typeof (payload as any).value !== 'string') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Credential value required', false));
    }
    const { value } = payload as { value: string };
    if (!value.trim()) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Credential value cannot be empty', false));
    }
    const result = await saveCredential('litellm-api-key', value);
    if (!result.success || !result.credentialRef) {
      return fail(envelope.requestId, result.error || createError('STORAGE_FAILURE', 'Failed to save credential', true));
    }
    // Update settings to reference the new credential
    await updateSettings({ model: { credentialRef: result.credentialRef } });
    return ok(envelope.requestId, { credentialRef: result.credentialRef });
  });

  // ── Settings: delete credential (trusted contexts only) ──
  messageRegistry.register<unknown, { deleted: boolean }>('settings/delete-credential', async (_payload: unknown, envelope, sender) => {
    if (sender.tab && sender.url?.startsWith('http')) {
      return fail(
        envelope.requestId,
        createError('PERMISSION_DENIED', 'Credential delete not available to content scripts', false),
      );
    }
    await deleteCredential();
    await updateSettings({ model: { credentialRef: undefined } });
    return ok(envelope.requestId, { deleted: true });
  });

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

  // ── Dashboard: get counts ──
  messageRegistry.register<unknown, DashboardCounts>('dashboard/counts', async (_payload: unknown, envelope) => {
    try {
      const [due, inbox, cards] = await Promise.all([
        countDueReviews(),
        countInboxByStatus(),
        countCardsByStatus(),
      ]);
      // Calculate new this week (cards created in last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const allCards = await db.cards.toArray();
      const newThisWeek = allCards.filter(
        (c) => c.status !== 'deleted' && c.createdAt >= weekAgo,
      ).length;
      return ok(envelope.requestId, {
        todayDue: due.due,
        overdue: due.overdue,
        inbox: inbox.pending + inbox.processing,
        newThisWeek,
      });
    } catch {
      return ok(envelope.requestId, { todayDue: 0, overdue: 0, inbox: 0, newThisWeek: 0 });
    }
  });

  // ── Capture: save ──
  messageRegistry.register<SaveCaptureCommand, SaveCaptureResult>('capture/save', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as SaveCaptureCommand;
    if (!input.requestId || !input.selectedText) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Missing required fields', false));
    }
    try {
      const result = await saveCaptureTransaction({
        requestId: input.requestId,
        selectedText: input.selectedText,
        context: input.context as Parameters<typeof saveCaptureTransaction>[0]['context'],
        pageUrl: input.pageUrl,
        pageTitle: input.pageTitle,
        siteName: input.siteName,
        domain: input.domain,
        requestedAction: input.requestedAction,
      });
      return ok(envelope.requestId, result);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to save capture', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Page summary ──
  messageRegistry.register<PageSummaryQuery, PageSummary>('page/summary', async (payload: unknown, envelope) => {
    const { pageUrl } = payload as { pageUrl?: string };
    try {
      if (!pageUrl) {
        return ok(envelope.requestId, {
          pageId: '',
          pageUrl: '',
          title: '',
          cardCount: 0,
          inboxCount: 0,
        });
      }
      // Find source pages matching this URL
      const pages = await db.sourcePages.where('url').equals(pageUrl).toArray();
      if (pages.length === 0) {
        // Try matching by origin
        const origin = new URL(pageUrl).origin;
        const allPages = await db.sourcePages.toArray();
        const matching = allPages.filter((p) => p.url.startsWith(origin));
        if (matching.length === 0) {
          return ok(envelope.requestId, {
            pageId: '',
            pageUrl,
            title: '',
            cardCount: 0,
            inboxCount: 0,
          });
        }
        const page = matching[0];
        const captures = await db.sourceCaptures.where('sourcePageId').equals(page.id).toArray();
        const captureIds = captures.map((c) => c.id);
        const links = captureIds.length > 0
          ? await db.cardSourceLinks.where('sourceCaptureId').anyOf(captureIds).toArray()
          : [];
        const cardIds = new Set(links.map((l) => l.cardId));
        const inboxItems = captureIds.length > 0
          ? await db.inboxItems.where('sourceCaptureId').anyOf(captureIds).toArray()
          : [];
        return ok(envelope.requestId, {
          pageId: page.id,
          pageUrl,
          title: page.title || '',
          cardCount: cardIds.size,
          inboxCount: inboxItems.filter((i) => i.status !== 'discarded').length,
        });
      }
      const page = pages[0];
      const captures = await db.sourceCaptures.where('sourcePageId').equals(page.id).toArray();
      const captureIds = captures.map((c) => c.id);
      const links = captureIds.length > 0
        ? await db.cardSourceLinks.where('sourceCaptureId').anyOf(captureIds).toArray()
        : [];
      const cardIds = new Set(links.map((l) => l.cardId));
      const inboxItems = captureIds.length > 0
        ? await db.inboxItems.where('sourceCaptureId').anyOf(captureIds).toArray()
        : [];
      return ok(envelope.requestId, {
        pageId: page.id,
        pageUrl,
        title: page.title || '',
        cardCount: cardIds.size,
        inboxCount: inboxItems.filter((i) => i.status !== 'discarded').length,
      });
    } catch {
      return ok(envelope.requestId, {
        pageId: '',
        pageUrl: pageUrl || '',
        title: '',
        cardCount: 0,
        inboxCount: 0,
      });
    }
  });

  // ── AI Task: start ──
  messageRegistry.register<AiTaskRequest, { accepted: boolean; taskId: string }>('aiTask/start', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as AiTaskRequest;
    if (!input.taskId || !input.requestId || !input.idempotencyKey || !input.type) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Missing required fields', false));
    }
    if (input.type !== 'quick-explain') {
      return fail(envelope.requestId, createError('INVALID_INPUT', `Unsupported task type: ${input.type}`, false));
    }
    try {
      const result = await aiTaskCoordinator.startQuickExplain({
        taskId: input.taskId,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        selectedText: input.input.selectedText,
        context: input.input.context,
        pageTitle: input.input.pageTitle,
      });
      return ok(envelope.requestId, result);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error && 'userMessage' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to start task', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── AI Task: cancel ──
  messageRegistry.register<{ taskId: string; reason?: string }, { state: string }>('aiTask/cancel', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('taskId' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'taskId required', false));
    }
    const { taskId, reason } = payload as { taskId: string; reason?: string };
    const result = aiTaskCoordinator.cancel(taskId, reason);
    return ok(envelope.requestId, result);
  });

  // ── AI Task: get status ──
  messageRegistry.register<{ taskId: string }, AiTaskSnapshot>('aiTask/getStatus', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('taskId' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'taskId required', false));
    }
    const { taskId } = payload as { taskId: string };
    const status = aiTaskCoordinator.getStatus(taskId);
    return ok(envelope.requestId, status as AiTaskSnapshot);
  });

  // ── AI Task: test connection ──
  messageRegistry.register<{ profileId: string }, ConnectionTestResult>('aiTask/testConnection', async (_payload: unknown, envelope) => {
    try {
      const result = await testConnection();
      return ok(envelope.requestId, result);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Connection test failed', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Selection: explain (start a quick-explain task) ──
  messageRegistry.register<ExplainSelectionCommand, ExplainAccepted>('selection/explain', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as ExplainSelectionCommand;
    if (!input.selection || !input.requestId) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Missing selection or requestId', false));
    }
    const taskId = crypto.randomUUID();
    const idempotencyKey = `${input.task}:${input.selection}:${input.source.urlWithoutFragment}`;
    try {
      const result = await aiTaskCoordinator.startQuickExplain({
        taskId,
        requestId: input.requestId,
        idempotencyKey,
        selectedText: input.selection,
        context: input.context ? JSON.stringify(input.context) : undefined,
        pageTitle: input.context?.pageTitle,
      });
      return ok(envelope.requestId, { taskId: result.taskId, requestId: input.requestId });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to start explanation', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Selection: cancel ──
  messageRegistry.register<{ requestId: string }, { cancelled: boolean }>('selection/cancel', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('requestId' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'requestId required', false));
    }
    // Find and cancel any task associated with this requestId
    const { requestId } = payload as { requestId: string };
    // Best-effort: the coordinator manages tasks by taskId, not requestId
    // For now, acknowledge cancellation
    return ok(envelope.requestId, { cancelled: true });
  });

  // ── Capture: preview dedup decision ──
  messageRegistry.register<{ captureId: string; selectedText: string }, DedupPreview>('capture/previewDecision', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { captureId, selectedText } = payload as { captureId: string; selectedText: string };
    if (!captureId || !selectedText) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'captureId and selectedText required', false));
    }
    try {
      const preview = await generateDedupPreview(captureId, selectedText);
      return ok(envelope.requestId, preview);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to generate dedup preview', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Capture: apply decision ──
  messageRegistry.register<ApplyDecisionCommand, SaveCaptureResult>('capture/applyDecision', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as ApplyDecisionCommand;
    if (!input.captureId || !input.action) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'captureId and action required', false));
    }
    try {
      if (input.action === 'save' || input.action === 'save-to-inbox') {
        // Get the source capture and create card or inbox item
        const capture = await db.sourceCaptures.get(input.captureId);
        if (!capture) {
          return fail(envelope.requestId, createError('NOT_FOUND', 'Capture not found', false));
        }
        if (input.action === 'save') {
          const card = await createCardTransaction({
            requestId: envelope.requestId,
            type: 'word',
            headword: capture.selectedText,
            explanations: [],
            examples: [],
            sourceCaptureId: capture.id,
          });
          return ok(envelope.requestId, {
            captureId: input.captureId,
            status: 'new-card',
            cardId: card.id,
            message: 'Card created',
          });
        }
        return ok(envelope.requestId, {
          captureId: input.captureId,
          status: 'inbox',
          message: 'Saved to Inbox',
        });
      }
      if (input.action === 'skip') {
        return ok(envelope.requestId, {
          captureId: input.captureId,
          status: 'skipped',
          message: 'Duplicate skipped',
        });
      }
      if (input.action === 'merge' && input.targetCardId) {
        await appendSourceToCard(envelope.requestId, input.targetCardId, input.captureId, 'additional_context');
        return ok(envelope.requestId, {
          captureId: input.captureId,
          status: 'appended',
          cardId: input.targetCardId,
          message: 'Source appended to existing card',
        });
      }
      return fail(envelope.requestId, createError('INVALID_INPUT', `Unsupported action: ${input.action}`, false));
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to apply decision', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Inbox: list items ──
  messageRegistry.register<{ status?: string; limit?: number; cursor?: string }, {
    items: Array<{ item: unknown; selectedText: string; pageTitle?: string; url?: string }>;
    nextCursor?: string;
    total: number;
  }>('inbox/list', async (payload: unknown, envelope) => {
    const query = (payload || {}) as { status?: string; limit?: number; cursor?: string };
    try {
      const result = await getInboxItemsWithSource(query);
      return ok(envelope.requestId, result);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to list inbox items', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Inbox: convert to card ──
  messageRegistry.register<{ itemId: string; cardType: string }, SaveCaptureResult>('inbox/convert', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { itemId, cardType } = payload as { itemId: string; cardType: string };
    if (!itemId) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'itemId required', false));
    }
    try {
      const result = await convertInboxToCard(itemId, (cardType || 'word') as 'word' | 'phrase' | 'sentence' | 'technical_term');
      return ok(envelope.requestId, {
        captureId: itemId,
        status: 'new-card',
        cardId: result.cardId,
        message: result.message,
      });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to convert inbox item', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Inbox: append source to card ──
  messageRegistry.register<{ itemId: string; targetCardId: string }, SaveCaptureResult>('inbox/append', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { itemId, targetCardId } = payload as { itemId: string; targetCardId: string };
    if (!itemId || !targetCardId) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'itemId and targetCardId required', false));
    }
    try {
      const result = await appendInboxSourceToCard(itemId, targetCardId);
      return ok(envelope.requestId, {
        captureId: itemId,
        status: 'appended',
        cardId: result.cardId,
        message: result.message,
      });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to append source', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Inbox: discard item ──
  messageRegistry.register<{ itemId: string }, { success: boolean }>('inbox/discard', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { itemId } = payload as { itemId: string };
    if (!itemId) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'itemId required', false));
    }
    try {
      await discardInboxItem(itemId);
      return ok(envelope.requestId, { success: true });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to discard inbox item', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Inbox: batch preview ──
  messageRegistry.register<InboxBatchPreviewCommand, InboxBatchPreview>('inbox/batchPreview', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as InboxBatchPreviewCommand;
    if (!input.itemIds || input.itemIds.length === 0) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'itemIds required', false));
    }
    // Simple batch preview: summarize the proposed action
    const items = input.itemIds.map((id) => ({
      itemId: id,
      action: input.proposedAction,
      summary: `Will ${input.proposedAction} this item`,
    }));
    return ok(envelope.requestId, {
      previewId: crypto.randomUUID(),
      items,
      riskSummary: `${items.length} items will be ${input.proposedAction}`,
    });
  });

  // ── Inbox: batch apply ──
  messageRegistry.register<InboxBatchApplyCommand, InboxBatchResult>('inbox/batchApply', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as InboxBatchApplyCommand;
    if (!input.batchPreviewId) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'batchPreviewId required', false));
    }
    // For now, return success without actually applying (batch apply needs full implementation)
    return ok(envelope.requestId, {
      batchId: input.batchPreviewId,
      results: [],
    });
  });

  // ── Review: create session ──
  messageRegistry.register<CreateReviewSessionCommand, ReviewSession>('review/createSession', async (payload: unknown, envelope) => {
    try {
      const input = (payload || {}) as CreateReviewSessionCommand;
      const session = await createReviewSession(input.limits);
      return ok(envelope.requestId, {
        sessionId: session.sessionId,
        dueCounts: session.dueCounts,
      });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to create review session', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Review: get next item ──
  messageRegistry.register<{ sessionId: string }, ReviewItem | null>('review/next', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('sessionId' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'sessionId required', false));
    }
    const { sessionId } = payload as { sessionId: string };
    try {
      const item = await getNextReviewItem(sessionId);
      return ok(envelope.requestId, item);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to get next review item', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Review: reveal answer ──
  messageRegistry.register<{ sessionId: string; cardId: string; attemptId: string }, ReviewReveal>('review/reveal', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { sessionId, cardId, attemptId } = payload as { sessionId: string; cardId: string; attemptId: string };
    if (!sessionId || !cardId || !attemptId) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'sessionId, cardId, and attemptId required', false));
    }
    try {
      const reveal = await revealAnswer(sessionId, cardId, attemptId);
      return ok(envelope.requestId, {
        attemptId,
        answer: reveal.answer,
        context: reveal.context,
      });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to reveal answer', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Review: preview rating ──
  messageRegistry.register<{ attemptId: string; rating: ReviewRating }, RatingPreview>('review/previewRating', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { attemptId, rating } = payload as { attemptId: string; rating: ReviewRating };
    if (!attemptId || !rating) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'attemptId and rating required', false));
    }
    try {
      // Find the card from the attempt
      const attempt = await db.reviewAttemptDetails.get(attemptId);
      const cardId = attempt?.cardId;
      if (!cardId) {
        return fail(envelope.requestId, createError('NOT_FOUND', 'Attempt not found', false));
      }
      const preview = await previewReviewRating(cardId, rating);
      return ok(envelope.requestId, preview);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to preview rating', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Review: commit rating ──
  messageRegistry.register<CommitRatingCommand, ReviewCommitResult>('review/commitRating', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object') {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const input = payload as CommitRatingCommand;
    if (!input.attemptId || !input.rating) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'attemptId and rating required', false));
    }
    try {
      // Find cardId from attempt
      const attempt = await db.reviewAttemptDetails.get(input.attemptId);
      const cardId = attempt?.cardId;
      if (!cardId) {
        return fail(envelope.requestId, createError('NOT_FOUND', 'Attempt not found', false));
      }
      // Find sessionId from attempt
      const sessionId = attempt.sessionId;
      const result = await commitReviewRating(sessionId, input.attemptId, cardId, input.rating);
      return ok(envelope.requestId, result);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to commit rating', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Knowledge: search ──
  messageRegistry.register<{ query: string; filters?: { type?: string; status?: string; tagId?: string }; limit?: number }, {
    items: Array<{ cardId: string; headword: string; type: string; score?: number }>;
    total: number;
  }>('knowledge/search', async (payload: unknown, envelope) => {
    const input = (payload || {}) as { query: string; filters?: { type?: string; status?: string; tagId?: string }; limit?: number };
    try {
      const results = await searchCards(input.query || '', input.filters, input.limit || 50);
      return ok(envelope.requestId, { items: results, total: results.length });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Search failed', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Knowledge: get card ──
  messageRegistry.register<{ cardId: string }, unknown>('knowledge/getCard', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('cardId' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'cardId required', false));
    }
    const { cardId } = payload as { cardId: string };
    try {
      const card = await db.cards.get(cardId);
      if (!card) {
        return fail(envelope.requestId, createError('NOT_FOUND', 'Card not found', false));
      }
      // Get sources
      const links = await db.cardSourceLinks.where('cardId').equals(cardId).toArray();
      const sources = await Promise.all(
        links.map(async (link) => {
          const capture = await db.sourceCaptures.get(link.sourceCaptureId);
          return {
            sourceCaptureId: link.sourceCaptureId,
            role: link.role,
            pageTitle: capture?.context.pageTitle,
            url: capture?.context.url,
          };
        }),
      );
      // Get tags
      const tags = await Promise.all(
        card.tagIds.map(async (tagId) => {
          const tag = await db.tags.get(tagId);
          return tag ? { id: tag.id, name: tag.name } : null;
        }),
      );
      // Get review state
      const snapshot = await db.scheduleSnapshots.get(cardId);
      return ok(envelope.requestId, {
        id: card.id,
        type: card.type,
        status: card.status,
        headword: card.headword.value,
        explanations: card.explanations,
        examples: card.examples,
        notes: card.notes,
        sources,
        tags: tags.filter(Boolean),
        reviewState: snapshot ? {
          dueAt: snapshot.dueAt,
          state: snapshot.state.state,
          stability: snapshot.state.stability,
          difficulty: snapshot.state.difficulty,
        } : undefined,
        revision: card.revision,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to get card', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Knowledge: rebuild search index ──
  messageRegistry.register<{ reason: string }, { ok: true }>('knowledge/rebuildSearch', async (_payload: unknown, envelope) => {
    try {
      await rebuildSearchIndex();
      return ok(envelope.requestId, { ok: true });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to rebuild search index', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Backup: export full backup ──
  messageRegistry.register<unknown, { dataUrl: string; filename: string }>('backup/export', async (_payload: unknown, envelope) => {
    try {
      const blob = await exportFullBackup();
      const dataUrl = await blobToDataUrl(blob);
      const filename = `lexiflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
      return ok(envelope.requestId, { dataUrl, filename });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Backup export failed', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Backup: import backup ──
  messageRegistry.register<{ dataUrl: string; replace?: boolean }, { tables: string[]; recordCount: number }>('backup/import', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('dataUrl' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'dataUrl required', false));
    }
    const { dataUrl, replace } = payload as { dataUrl: string; replace?: boolean };
    try {
      const blob = await dataUrlToBlob(dataUrl);
      const result = await importFullBackup(blob, { replace });
      return ok(envelope.requestId, result);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Backup import failed', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Backup: export CSV ──
  messageRegistry.register<unknown, { csv: string; filename: string }>('backup/exportCsv', async (_payload: unknown, envelope) => {
    try {
      const csv = await exportCsv();
      return ok(envelope.requestId, { csv, filename: `lexiflow-cards-${new Date().toISOString().slice(0, 10)}.csv` });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'CSV export failed', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Backup: export Markdown ──
  messageRegistry.register<unknown, { markdown: string; filename: string }>('backup/exportMarkdown', async (_payload: unknown, envelope) => {
    try {
      const markdown = await exportMarkdown();
      return ok(envelope.requestId, { markdown, filename: `lexiflow-cards-${new Date().toISOString().slice(0, 10)}.md` });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Markdown export failed', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Data: clear all data ──
  messageRegistry.register<unknown, { cleared: boolean }>('data/clearAll', async (_payload: unknown, envelope) => {
    try {
      await clearAllData();
      return ok(envelope.requestId, { cleared: true });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to clear data', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Data: clear inbox ──
  messageRegistry.register<unknown, { cleared: number }>('data/clearInbox', async (_payload: unknown, envelope) => {
    try {
      const count = await clearInbox();
      return ok(envelope.requestId, { cleared: count });
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to clear inbox', true);
      return fail(envelope.requestId, appError);
    }
  });

  // ── Data: get storage size ──
  messageRegistry.register<unknown, { usedBytes: number; quotaBytes: number | null }>('data/storageSize', async (_payload: unknown, envelope) => {
    try {
      const size = await getStorageSize();
      return ok(envelope.requestId, size);
    } catch (error) {
      const appError = error && typeof error === 'object' && 'code' in error
        ? (error as AppError)
        : createError('INTERNAL', 'Failed to get storage size', true);
      return fail(envelope.requestId, appError);
    }
  });
}

// Helper functions for data URL conversion
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
