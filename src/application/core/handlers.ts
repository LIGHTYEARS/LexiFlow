import { messageRegistry } from '@infra/messaging/message-registry';
import { ok, fail, createError } from '@shared/protocol/envelope';
import {
  getSitePolicyView,
  getSettings,
  updateSettings,
  saveCredential,
  hasCredential,
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
  getAuthorizedOrigins,
  registerContentScriptsForOrigins,
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
  DedupPreview,
  ApplyDecisionCommand,
  SaveCaptureResult,
  InboxBatchPreviewCommand,
  InboxBatchPreview,
  InboxBatchApplyCommand,
  InboxBatchResult,
  SearchCommand,
  SearchResult,
  CardDetail,
  PreviewPatchCommand,
  PatchPreview,
  ApplyPatchCommand,
  SourcePageResult,
  CreateReviewSessionCommand,
  ReviewSession,
  ReviewItem,
  ReviewReveal,
  RatingPreview,
  CommitRatingCommand,
  ReviewCommitResult,
  AnnotateErrorCommand,
  RebuildReport,
  FsrsImpactPreview,
  ReviewRating,
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
    // Check actual credential store (not just the ref in settings)
    const hasCred = await hasCredential();
    // Never return credential value, only whether it's set
    return ok(envelope.requestId, {
      ...settings,
      model: {
        baseUrl: settings.model.baseUrl,
        hasCredential: hasCred,
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

    // Re-register content scripts for all authorized origins (including this one)
    // so future page loads on this origin get the content script.
    const allOrigins = await getAuthorizedOrigins();
    await registerContentScriptsForOrigins(allOrigins);

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

  // ── Capture: preview deduplication decision ──
  messageRegistry.register<{ captureId: string }, DedupPreview>(
    'capture/previewDecision',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('captureId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const { captureId } = payload as { captureId: string };
      return ok(envelope.requestId, { captureId, suggestions: [] });
    },
  );

  // ── Capture: apply deduplication decision ──
  messageRegistry.register<ApplyDecisionCommand, SaveCaptureResult>(
    'capture/applyDecision',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('captureId' in payload) || !('action' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const command = payload as ApplyDecisionCommand;
      if (command.action === 'save' || command.action === 'save-to-inbox') {
        // Placeholder: a full implementation would look up the capture by ID and
        // call saveCaptureTransaction with the resolved capture data.
        return ok(envelope.requestId, {
          captureId: command.captureId,
          status: 'inbox',
          message: 'Saved to Inbox for review',
        });
      }
      return ok(envelope.requestId, {
        captureId: command.captureId,
        status: 'skipped',
        message: 'Capture skipped',
      });
    },
  );

  // ── Inbox: batch preview ──
  messageRegistry.register<InboxBatchPreviewCommand, InboxBatchPreview>(
    'inbox/batchPreview',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('itemIds' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        previewId: crypto.randomUUID(),
        items: [],
        riskSummary: '',
      });
    },
  );

  // ── Inbox: batch apply ──
  messageRegistry.register<InboxBatchApplyCommand, InboxBatchResult>(
    'inbox/batchApply',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('batchPreviewId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        batchId: crypto.randomUUID(),
        results: [],
      });
    },
  );

  // ── Inbox: undo batch ──
  messageRegistry.register<{ batchId: string; expectedRevision: number }, { reverted: boolean }>(
    'inbox/undoBatch',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('batchId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, { reverted: true });
    },
  );

  // ── Knowledge: search ──
  messageRegistry.register<SearchCommand, SearchResult>(
    'knowledge/search',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('query' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, { items: [], total: 0 });
    },
  );

  // ── Knowledge: get card detail ──
  messageRegistry.register<{ cardId: string }, CardDetail>(
    'knowledge/getCard',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('cardId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      const { cardId } = payload as { cardId: string };
      return ok(envelope.requestId, {
        id: cardId,
        type: 'word',
        status: 'active',
        headword: '',
        explanations: [],
        examples: [],
        sources: [],
        tags: [],
        relations: [],
        revision: 0,
        createdAt: '',
        updatedAt: '',
      });
    },
  );

  // ── Knowledge: preview patch ──
  messageRegistry.register<PreviewPatchCommand, PatchPreview>(
    'knowledge/previewPatch',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('cardId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        previewId: crypto.randomUUID(),
        diff: [],
        risk: 'low',
        requiresConfirmation: false,
      });
    },
  );

  // ── Knowledge: apply patch ──
  messageRegistry.register<ApplyPatchCommand, CardDetail>(
    'knowledge/applyPatch',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('previewId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        id: '',
        type: 'word',
        status: 'active',
        headword: '',
        explanations: [],
        examples: [],
        sources: [],
        tags: [],
        relations: [],
        revision: 0,
        createdAt: '',
        updatedAt: '',
      });
    },
  );

  // ── Knowledge: list cards by source page ──
  messageRegistry.register<{ pageId: string; cursor?: string; limit?: number }, SourcePageResult>(
    'knowledge/listBySource',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('pageId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        page: { id: '', url: '', title: '', domain: '' },
        cards: [],
        inboxCount: 0,
      });
    },
  );

  // ── Knowledge: rebuild search index ──
  messageRegistry.register<{ reason: string }, { ok: true }>(
    'knowledge/rebuildSearch',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('reason' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, { ok: true });
    },
  );

  // ── Knowledge: get page summary ──
  messageRegistry.register<{ canonicalPageKey: string }, PageSummary>(
    'knowledge/getPageSummary',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('canonicalPageKey' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        pageId: '',
        pageUrl: '',
        title: '',
        cardCount: 0,
        inboxCount: 0,
      });
    },
  );

  // ── Review: create session ──
  messageRegistry.register<CreateReviewSessionCommand, ReviewSession>(
    'review/createSession',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object') {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        sessionId: crypto.randomUUID(),
        dueCounts: { overdue: 0, due: 0, learning: 0, new: 0 },
      });
    },
  );

  // ── Review: next item ──
  messageRegistry.register<{ sessionId: string }, ReviewItem | null>(
    'review/next',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('sessionId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, null);
    },
  );

  // ── Review: reveal answer ──
  messageRegistry.register<
    { sessionId: string; cardId: string; attemptId: string },
    ReviewReveal
  >('review/reveal', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('attemptId' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { attemptId } = payload as { attemptId: string };
    return ok(envelope.requestId, {
      attemptId,
      answer: '',
    });
  });

  // ── Review: preview rating ──
  messageRegistry.register<
    { attemptId: string; rating: ReviewRating },
    RatingPreview
  >('review/previewRating', async (payload: unknown, envelope) => {
    if (!payload || typeof payload !== 'object' || !('attemptId' in payload) || !('rating' in payload)) {
      return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
    }
    const { rating } = payload as { attemptId: string; rating: ReviewRating };
    return ok(envelope.requestId, {
      rating,
      nextDueAt: '',
      state: 'new',
    });
  });

  // ── Review: commit rating ──
  messageRegistry.register<CommitRatingCommand, ReviewCommitResult>(
    'review/commitRating',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('attemptId' in payload) || !('rating' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        eventId: crypto.randomUUID(),
        nextDueAt: '',
        state: 'new',
      });
    },
  );

  // ── Review: annotate error ──
  messageRegistry.register<AnnotateErrorCommand, { annotated: boolean }>(
    'review/annotateError',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('eventId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, { annotated: true });
    },
  );

  // ── Review: rebuild schedule ──
  messageRegistry.register<{ cardIds?: string[]; dryRun: boolean }, RebuildReport>(
    'review/rebuildSchedule',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('dryRun' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, []);
    },
  );

  // ── Practice: preview FSRS impact ──
  messageRegistry.register<{ practiceAttemptIds: string[] }, FsrsImpactPreview>(
    'practice/previewFsrsImpact',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('practiceAttemptIds' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, {
        previewId: crypto.randomUUID(),
        impacts: [],
        summary: '',
      });
    },
  );

  // ── Practice: commit FSRS impact ──
  messageRegistry.register<{ previewId: string; confirmationToken: string }, { committed: boolean }>(
    'practice/commitFsrsImpact',
    async (payload: unknown, envelope) => {
      if (!payload || typeof payload !== 'object' || !('previewId' in payload)) {
        return fail(envelope.requestId, createError('INVALID_INPUT', 'Invalid payload', false));
      }
      return ok(envelope.requestId, { committed: true });
    },
  );
}
