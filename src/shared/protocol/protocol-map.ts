import type { AppResult } from '../protocol/envelope';
import type { UserSettings } from '@infra/storage/settings-schema';
import type { CardType, CardStatus } from '@domain/types';
import type { Card } from '@domain/card/card.model';
import type { ContextEvidence } from '@content-ui/context-extractor';
import type { ErrorType } from '@domain/error/error.model';

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
  'capture/mintConfirmation': (
    input: { targetCardId: string; captureId: string },
  ) => AppResult<{ token: string }>;
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
  'knowledge/listInbox': (
    input: { status?: string; limit?: number; cursor?: string },
  ) => AppResult<{ items: InboxListItem[]; nextCursor?: string }>;
  'knowledge/listSources': (
    input: { limit?: number; cursor?: string },
  ) => AppResult<{ pages: SourcePageListItem[]; nextCursor?: string }>;
  'knowledge/stats': () => AppResult<KnowledgeStats>;

  // ── Tags ──
  'tags/list': () => AppResult<{ tags: Array<{ id: string; name: string; cardCount: number }> }>;
  'tags/create': (input: { name: string }) => AppResult<{ id: string; isNew: boolean }>;
  'tags/rename': (input: { tagId: string; newName: string }) => AppResult<{ renamed: boolean }>;
  'tags/delete': (input: { tagId: string; confirmationToken: string }) => AppResult<{ deleted: boolean }>;
  'tags/merge': (
    input: { sourceTagId: string; targetTagId: string; confirmationToken: string },
  ) => AppResult<{ merged: boolean }>;
  'tags/bulkModify': (
    input: { cardIds: string[]; tagId: string; action: 'add' | 'remove'; confirmationToken: string },
  ) => AppResult<{ modified: number }>;
  'tags/mintConfirmation': (
    input: { operation: 'tags.bulk-modify' },
  ) => AppResult<{ token: string }>;

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
  'practice/generate': (
    input: { source: unknown; practiceType: string },
  ) => AppResult<{ sessionId: string; itemCount: number }>;
  'practice/recordAttempt': (
    input: { itemId: string; userAnswer: string; outcome: string; fsrsRating?: string },
  ) => AppResult<{ attemptId: string }>;
  'practice/getSession': (
    input: { sessionId: string },
  ) => AppResult<{ items: Array<{ itemId: string; type: string; prompt: string; explanation?: string; choices?: string[] }> }>;
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
  // Trusted credential setter — handler rejects content-script senders (data-handlers.ts)
  'settings/setCredential': (input: { apiKey: string }) => AppResult<{ credentialRef: string }>; // @trusted-credential-input
  'settings/clearCredential': () => AppResult<{ removed: boolean }>;
  'navigation/open': (input: OpenDestinationCommand) => AppResult<void>;

  // ── Data & Backup ──
  'data/exportBackup': () => AppResult<{ manifest: unknown; data: string }>;
  'data/exportCsv': () => AppResult<{ csv: string }>;
  'data/exportMarkdown': () => AppResult<{ markdown: string }>;
  'data/previewImport': (
    input: { data: string },
  ) => AppResult<{ databaseName: string; tables: Array<{ name: string; rowCount: number }>; confirmationToken: string }>;
  'data/import': (
    input: { data: string; mode: 'replace' | 'merge'; tableCount: number; confirmationToken: string },
  ) => AppResult<{ imported: boolean }>;
  'data/clearInbox': (input: { confirmationToken: string }) => AppResult<{ cleared: number }>;
  'data/clearAll': (input: { confirmationToken: string }) => AppResult<{ cleared: true }>;
  'data/mintConfirmation': (
    input: { operation: 'data.clear-inbox' | 'data.clear-all' },
  ) => AppResult<{ token: string }>;

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
  context?: Partial<ContextEvidence>;
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

export type InboxBatchAction = 'save' | 'save-to-inbox' | 'skip' | 'merge';

export type InboxBatchPreviewCommand = {
  itemIds: string[];
  proposedAction: InboxBatchAction;
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

export type SearchFilters = {
  type?: CardType;
  status?: CardStatus;
  tagId?: string;
};

export type SearchCommand = {
  query: string;
  filters?: SearchFilters;
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
  type: CardType;
  status: CardStatus;
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
  patch: Partial<Card>;
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

export type ReviewMode = 'quick' | 'input' | 'cloze' | 'imitation' | 'distinction';

export type CreateReviewSessionCommand = {
  dateBoundary?: string;
  limits?: { maxNew?: number; maxReview?: number };
  modes?: ReviewMode[];
};

export type ReviewSession = {
  sessionId: string;
  dueCounts: { overdue: number; due: number; learning: number; new: number };
};

export type ReviewItem = {
  attemptId: string;
  cardId: string;
  prompt: string;
  mode: ReviewMode;
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

export type FsrsState = 'new' | 'learning' | 'review' | 'relearning';

export type RatingPreview = {
  rating: ReviewRating;
  nextDueAt: string;
  state: FsrsState;
};

export type CommitRatingCommand = {
  attemptId: string;
  rating: ReviewRating;
  expectedSequence: number;
};

export type ReviewCommitResult = {
  eventId: string;
  nextDueAt: string;
  state: FsrsState;
};

export type AnnotateErrorCommand = {
  eventId: string;
  confirmedTypes: ErrorType[];
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

export type AiTaskType = 'quick-explain' | 'full-analysis' | 'practice-generate';

export type AiTaskRequest = {
  taskId: string;
  requestId: string;
  idempotencyKey: string;
  intentId: string;
  type: AiTaskType;
  input: { selectedText: string; context?: string; pageTitle?: string };
  modelProfileId: string;
  promptVersion: string;
};

export type AiTaskState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AiTaskSnapshot = {
  taskId: string;
  state: AiTaskState;
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
 * Capture destination — where a new capture is routed by default.
 * Keep in sync with the `automation.newCaptureDestination` enum in
 * settings-schema.ts.
 */
export type CaptureDestination = 'inbox' | 'library';

/**
 * User settings view — derived from the stored settings schema but with
 * `credentialRef` stripped (security: never expose credential references
 * to content scripts or extension UI) and a derived `hasCredential` flag
 * added so callers know whether a credential is configured.
 */
export type UserSettingsView = Omit<UserSettings, 'model' | 'automation'> & {
  model: Omit<UserSettings['model'], 'credentialRef'> & { hasCredential: boolean };
  automation: Omit<UserSettings['automation'], 'newCaptureDestination'> & {
    newCaptureDestination: CaptureDestination;
  };
};

export type SettingsUpdateCommand = {
  patch: Partial<UserSettings>;
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

export type InboxListItem = {
  itemId: string;
  status: string;
  selectedText: string;
  pageTitle?: string;
  url?: string;
  createdAt: string;
  hasFailure: boolean;
  suggestions: Array<{ confidence: string; targetCardId?: string; rationale?: string }>;
};

export type SourcePageListItem = {
  pageId: string;
  url: string;
  title: string;
  domain: string;
  cardCount: number;
  inboxCount: number;
  lastCapturedAt: string;
};

export type KnowledgeStats = {
  totalCards: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  newThisWeek: number;
  reviewsToday: number;
  dueCounts: { overdue: number; due: number; learning: number; new: number };
  topErrorTypes: Array<{ type: string; count: number }>;
};
