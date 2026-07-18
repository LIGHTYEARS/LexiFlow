import type { Card } from '@domain/card/card.model';
import type { SourceCapture } from '@domain/source/source.model';

/**
 * Repository interface — the only way to read/write domain data.
 * Components, content scripts, and adapters must NOT use Dexie directly.
 * See technical-design/04 §7.
 */
export interface KnowledgeRepository {
  // ── Capture & Source ──
  saveCapture(command: SaveCaptureCommand): Promise<SaveCaptureResult>;
  getSourceCapture(id: string): Promise<SourceCapture | undefined>;

  // ── Cards ──
  getCard(id: string): Promise<Card | undefined>;
  queryCards(query: CardQuery): Promise<CardQueryResult>;
  reviseCard(command: ReviseCardCommand): Promise<Card>;

  // ── Inbox ──
  getInboxItems(query: { status?: string; limit?: number; cursor?: string }): Promise<{
    items: unknown[];
    nextCursor?: string;
  }>;

  // ── Review ──
  recordReview(command: RecordReviewCommand): Promise<ReviewResult>;
  getDueCards(query: DueCardsQuery): Promise<DueCardsResult>;

  // ── Organization ──
  applyOrganizationPlan(command: ApplyPlanCommand): Promise<OperationResult>;
}

// ── Command & Result Types ──

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

export type CardQuery = {
  type?: string;
  status?: string;
  tagIds?: string[];
  sourceDomain?: string;
  search?: string;
  cursor?: string;
  limit: number;
};

export type CardQueryResult = {
  cards: Card[];
  nextCursor?: string;
  total: number;
};

export type ReviseCardCommand = {
  cardId: string;
  expectedRevision: number;
  patch: Record<string, unknown>;
  confirmationToken?: string;
};

export type RecordReviewCommand = {
  attemptId: string;
  cardId: string;
  sessionId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  mode: string;
  expectedSequence: number;
  answer?: string;
  durationMs?: number;
};

export type ReviewResult = {
  eventId: string;
  nextDueAt: string;
  state: string;
};

export type DueCardsQuery = {
  limit: number;
  includeNew: boolean;
  maxNew: number;
};

export type DueCardsResult = {
  cards: Array<{ cardId: string; attemptId: string; priority: string }>;
};

export type ApplyPlanCommand = {
  requestId: string;
  operations: unknown[];
  confirmationToken?: string;
};

export type OperationResult = {
  operationId: string;
  results: Array<{ entityId: string; success: boolean; error?: string }>;
  undoAvailable: boolean;
};
