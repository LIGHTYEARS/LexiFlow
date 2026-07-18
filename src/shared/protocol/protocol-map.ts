import type { AppResult } from '../protocol/envelope';

/**
 * ProtocolMap defines all typed messages between extension surfaces.
 * Used by @webext-core/messaging. See technical-design/02 §5.
 *
 * Classification:
 * - Command: may change state, must carry requestId
 * - Query: read-only, retryable
 * - Event: notification only, receiver re-queries
 * - Progress: bound to requestId, monotonically increasing
 */
export interface ProtocolMap {
  // ── Selection & Explanation ──
  'selection/explain': (
    input: ExplainSelectionCommand,
  ) => AppResult<ExplainAccepted>;
  'selection/cancel': (
    input: { requestId: string },
  ) => AppResult<{ cancelled: boolean }>;

  // ── Capture & Inbox ──
  'capture/save': (input: SaveCaptureCommand) => AppResult<SaveCaptureResult>;
  'capture/previewDecision': (
    input: { captureId: string },
  ) => AppResult<DedupPreview>;
  'capture/applyDecision': (
    input: ApplyDecisionCommand,
  ) => AppResult<SaveCaptureResult>;
  'inbox/batchPreview': (
    input: InboxBatchPreviewCommand,
  ) => AppResult<InboxBatchPreview>;
  'inbox/batchApply': (
    input: InboxBatchApplyCommand,
  ) => AppResult<InboxBatchResult>;
  'inbox/undoBatch': (
    input: { batchId: string; expectedRevision: number },
  ) => AppResult<{ reverted: boolean }>;

  // ── Knowledge & Search ──
  'knowledge/search': (input: SearchCommand) => AppResult<SearchResult>;
  'knowledge/getCard': (input: { cardId: string }) => AppResult<CardDetail>;
  'knowledge/previewPatch': (
    input: PreviewPatchCommand,
  ) => AppResult<PatchPreview>;
  'knowledge/applyPatch': (
    input: ApplyPatchCommand,
  ) => AppResult<CardDetail>;
  'knowledge/listBySource': (
    input: { pageId: string; cursor?: string; limit?: number },
  ) => AppResult<SourcePageResult>;
  'knowledge/rebuildSearch': (input: { reason: string }) => AppResult<{ ok: true }>;
  'knowledge/getPageSummary': (
    input: { canonicalPageKey: string },
  ) => AppResult<PageSummary>;

  // ── Review & FSRS ──
  'review/createSession': (
    input: CreateReviewSessionCommand,
  ) => AppResult<ReviewSession>;
  'review/next': (input: { sessionId: string }) => AppResult<ReviewItem | null>;
  'review/reveal': (
    input: { sessionId: string; cardId: string; attemptId: string },
  ) => AppResult<ReviewReveal>;
  'review/previewRating': (
    input: { attemptId: string; rating: ReviewRating },
  ) => AppResult<RatingPreview>;
  'review/commitRating': (
    input: CommitRatingCommand,
  ) => AppResult<ReviewCommitResult>;
  'review/annotateError': (
    input: AnnotateErrorCommand,
  ) => AppResult<{ annotated: boolean }>;
  'review/rebuildSchedule': (
    input: { cardIds?: string[]; dryRun: boolean },
  ) => AppResult<RebuildReport>;

  // ── Practice ──
  'practice/previewFsrsImpact': (
    input: { practiceAttemptIds: string[] },
  ) => AppResult<FsrsImpactPreview>;
  'practice/commitFsrsImpact': (
    input: { previewId: string; confirmationToken: string },
  ) => AppResult<{ committed: boolean }>;

  // ── AI Tasks ──
  'aiTask/start': (input: AiTaskRequest) => AppResult<{ accepted: boolean; taskId: string }>;
  'aiTask/cancel': (
    input: { taskId: string; reason?: string },
  ) => AppResult<{ state: string }>;
  'aiTask/getStatus': (input: { taskId: string }) => AppResult<AiTaskSnapshot>;
  'aiTask/testConnection': (
    input: { profileId: string },
  ) => AppResult<ConnectionTestResult>;

  // ── Settings & Navigation ──
  'settings/site-policy': (
    input: SitePolicyQuery,
  ) => AppResult<SitePolicyView>;
  'settings/get': () => AppResult<UserSettingsView>;
  'settings/update': (input: SettingsUpdateCommand) => AppResult<{ updated: boolean }>;
  'navigation/open': (input: OpenDestinationCommand) => AppResult<void>;

  // ── Dashboard ──
  'dashboard/counts': () => AppResult<DashboardCounts>;
  'page/summary': (input: PageSummaryQuery) => AppResult<PageSummary>;
}

// ── Input/Output Type Placeholders ──
// These will be fully defined in their respective milestones.
// They exist here so the ProtocolMap compiles during M0 scaffold.

export type ExplainSelectionCommand = {
  requestId: string;
  selection: string;
  context?: Record<string, unknown>;
  source: { origin: string; urlWithoutFragment: string };
  task: 'quick-explain';
};

export type ExplainAccepted = {
  taskId: string;
  requestId: string;
};

export type SaveCaptureCommand = {
  requestId: string;
  selectionSnapshotId: string;
  requestedAction: 'save' | 'save-to-inbox';
  idempotencyKey: string;
};

export type SaveCaptureResult = {
  captureId: string;
  status: 'new-card' | 'appended' | 'skipped' | 'inbox' | 'failed';
  cardId?: string;
  message: string;
};

export type DedupPreview = {
  captureId: string;
  suggestions: unknown[];
};

export type ApplyDecisionCommand = {
  captureId: string;
  suggestionRevision: number;
  action: string;
  confirmationToken?: string;
};

export type InboxBatchPreviewCommand = {
  itemIds: string[];
  proposedAction: string;
};

export type InboxBatchPreview = {
  previewId: string;
  items: unknown[];
  riskSummary: string;
};

export type InboxBatchApplyCommand = {
  batchPreviewId: string;
  confirmationToken: string;
};

export type InboxBatchResult = {
  batchId: string;
  results: unknown[];
};

export type SearchCommand = {
  query: string;
  filters?: Record<string, unknown>;
  cursor?: string;
  limit?: number;
};

export type SearchResult = {
  items: unknown[];
  nextCursor?: string;
  total: number;
};

export type CardDetail = {
  id: string;
  type: string;
  status: string;
  headword: string;
  explanations: unknown[];
  examples: unknown[];
  sources: unknown[];
  tags: unknown[];
  relations: unknown[];
  reviewState?: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type PreviewPatchCommand = {
  cardId: string;
  expectedRevision: number;
  patch: Record<string, unknown>;
};

export type PatchPreview = {
  previewId: string;
  diff: unknown[];
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
};

export type ApplyPatchCommand = {
  previewId: string;
  confirmationToken?: string;
};

export type SourcePageResult = {
  page: unknown;
  cards: unknown[];
  inboxCount: number;
};

export type PageSummary = {
  pageId: string;
  pageUrl: string;
  title: string;
  cardCount: number;
  inboxCount: number;
  lastCapturedAt?: string;
};

export type PageSummaryQuery = {
  tabId?: number;
  pageUrl?: string;
};

export type CreateReviewSessionCommand = {
  dateBoundary?: string;
  limits?: { maxNew?: number; maxReview?: number };
  modes?: string[];
};

export type ReviewSession = {
  sessionId: string;
  dueCounts: { overdue: number; due: number; learning: number; new: number };
};

export type ReviewItem = {
  attemptId: string;
  cardId: string;
  prompt: string;
  mode: string;
};

export type ReviewReveal = {
  attemptId: string;
  answer: string;
  context?: unknown;
};

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type RatingPreview = {
  rating: ReviewRating;
  nextDueAt: string;
  state: string;
};

export type CommitRatingCommand = {
  attemptId: string;
  rating: ReviewRating;
  expectedSequence: number;
};

export type ReviewCommitResult = {
  eventId: string;
  nextDueAt: string;
  state: string;
};

export type AnnotateErrorCommand = {
  eventId: string;
  confirmedTypes: string[];
  note?: string;
};

export type RebuildReport = {
  cardId: string;
  eventsReplayed: number;
  driftDetected: boolean;
  newState?: unknown;
}[];

export type FsrsImpactPreview = {
  previewId: string;
  impacts: unknown[];
  summary: string;
};

export type AiTaskRequest = {
  taskId: string;
  requestId: string;
  idempotencyKey: string;
  intentId: string;
  type: string;
  input: { selectedText: string; context?: string; pageTitle?: string };
  modelProfileId: string;
  promptVersion: string;
};

export type AiTaskSnapshot = {
  taskId: string;
  state: string;
  progress?: number;
  result?: unknown;
  error?: string;
};

export type ConnectionTestResult = {
  ok: boolean;
  code?: string;
  message: string;
  latencyMs?: number;
};

export type SitePolicyQuery = {
  origin: string;
};

export type SitePolicyView = {
  origin: string;
  enabled: boolean;
  autoExplain: boolean;
};

export type UserSettingsView = {
  schemaVersion: number;
  selection: { autoExplain: boolean; disabledSites: string[] };
  automation: {
    skipExactDuplicate: boolean;
    appendExactContext: boolean;
    newCaptureDestination: string;
    requireConfirmationForAllWrites: boolean;
  };
  review: { dailyReviewLimit: number; dailyNewLimit: number };
  model: { baseUrl: string; hasCredential: boolean; taskModels: Record<string, string> };
};

export type SettingsUpdateCommand = {
  patch: Record<string, unknown>;
};

export type OpenDestinationCommand = {
  destination: 'dashboard' | 'review' | 'inbox' | 'settings';
  tabId?: number;
};

export type DashboardCounts = {
  todayDue: number;
  overdue: number;
  inbox: number;
  newThisWeek: number;
};
