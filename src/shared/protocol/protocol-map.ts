import type { AppResult } from '../protocol/envelope';
import type { UserSettings } from '@infra/storage/settings-schema';

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

export type DedupSuggestion = {
  candidateCardId: string;
  confidence: 'exact' | 'likely_same' | 'possibly_related' | 'insufficient_context';
  relationType?: string;
  rationale?: string;
};

export type DedupPreview = {
  captureId: string;
  suggestions: DedupSuggestion[];
};

export type ApplyDecisionAction = 'save' | 'save-to-inbox' | 'skip' | 'merge';

export type ApplyDecisionCommand = {
  captureId: string;
  suggestionRevision: number;
  action: ApplyDecisionAction;
  confirmationToken?: string;
};

export type InboxBatchPreviewCommand = {
  itemIds: string[];
  proposedAction: string;
};

export type InboxBatchItem = {
  itemId: string;
  action: string;
  summary: string;
};

export type InboxBatchPreview = {
  previewId: string;
  items: InboxBatchItem[];
  riskSummary: string;
};

export type InboxBatchApplyCommand = {
  batchPreviewId: string;
  confirmationToken: string;
};

export type InboxBatchResultItem = {
  itemId: string;
  success: boolean;
  error?: string;
  cardId?: string;
};

export type InboxBatchResult = {
  batchId: string;
  results: InboxBatchResultItem[];
};

export type SearchCommand = {
  query: string;
  filters?: Record<string, unknown>;
  cursor?: string;
  limit?: number;
};

export type SearchResultItem = {
  cardId: string;
  headword: string;
  type: 'word' | 'phrase' | 'sentence' | 'technical_term';
  excerpt?: string;
  matchFields?: string[];
};

export type SearchResult = {
  items: SearchResultItem[];
  nextCursor?: string;
  total: number;
};

export type CardReviewState = {
  dueAt?: string;
  state?: 'new' | 'learning' | 'review' | 'relearning';
  stability?: number;
  difficulty?: number;
};

export type CardDetail = {
  id: string;
  type: string;
  status: string;
  headword: string;
  explanations: Array<{ value: string; origin: string }>;
  examples: Array<{ value: string; origin: string }>;
  sources: Array<{
    sourceCaptureId: string;
    role: string;
    pageTitle?: string;
    url?: string;
  }>;
  tags: Array<{ id: string; name: string }>;
  relations: Array<{ cardId: string; type: string; direction?: string }>;
  reviewState?: CardReviewState;
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

export type SourcePageSummary = {
  id: string;
  url: string;
  title: string;
  domain: string;
  lastCapturedAt?: string;
};

export type SourcePageCard = {
  cardId: string;
  headword: string;
  type: 'word' | 'phrase' | 'sentence' | 'technical_term';
  role: 'origin' | 'additional_context' | 'example';
};

export type SourcePageResult = {
  page: SourcePageSummary;
  cards: SourcePageCard[];
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

export type ReviewRevealContext = {
  sentenceContaining?: string;
  paragraphExcerpt?: string;
  pageTitle?: string;
  url?: string;
};

export type ReviewReveal = {
  attemptId: string;
  answer: string;
  context?: ReviewRevealContext;
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

export type RebuildStateInfo = {
  dueAt: string;
  state: 'new' | 'learning' | 'review' | 'relearning';
  stability: number;
  difficulty: number;
};

export type RebuildReport = {
  cardId: string;
  eventsReplayed: number;
  driftDetected: boolean;
  newState?: RebuildStateInfo;
}[];

export type FsrsImpact = {
  cardId: string;
  currentDueAt: string;
  newDueAt: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
};

export type FsrsImpactPreview = {
  previewId: string;
  impacts: FsrsImpact[];
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

/**
 * User settings view — derived from the stored settings schema but with
 * `credentialRef` stripped (security: never expose credential references
 * to content scripts or extension UI) and a derived `hasCredential` flag
 * added so callers know whether a credential is configured.
 */
export type UserSettingsView = Omit<UserSettings, 'model'> & {
  model: Omit<UserSettings['model'], 'credentialRef'> & { hasCredential: boolean };
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
