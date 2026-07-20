import Dexie, { type Table } from 'dexie';
import type { Card } from '@domain/card/card.model';
import type { CardContent } from '@domain/card/card.model';
import type {
  SourcePage,
  SourceCapture,
  CardSourceLink,
} from '@domain/source/source.model';
import type { InboxItem } from '@domain/inbox/inbox.model';
import type { Tag, CardRelation } from '@domain/tag/tag.model';
import type {
  ReviewEvent,
  ScheduleSnapshot,
  ReviewAttemptDetail,
} from '@domain/review/review.model';
import type { ErrorAnnotation } from '@domain/error/error.model';

export interface ReviewSessionRecord {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt?: string;
  mode?: string;
  config?: {
    maxNew?: number;
    maxReview?: number;
    modes?: string[];
  };
}

export interface PracticeSessionRecord {
  id: string;
  status: 'preparing' | 'active' | 'completed' | 'cancelled' | 'failed';
  source: {
    type: string;
    cardIds: string[];
    errorIds: string[];
  };
  blueprint: {
    itemCount: number;
    types: string[];
  };
  affectsFsrs: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface PracticeItemRecord {
  id: string;
  sessionId: string;
  type: string;
  cardIds: string[];
  prompt: string;
  acceptAnswers?: string[];
  explanation?: string;
  source: 'rule' | 'model';
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface PracticeAttemptRecord {
  id: string;
  itemId: string;
  sessionId: string;
  userAnswer: string;
  outcome: 'correct' | 'incorrect' | 'partial' | 'skipped';
  score?: number;
  fsrsRating?: 'again' | 'hard' | 'good' | 'easy';
  durationMs?: number;
  createdAt: string;
}

export interface OperationLogRecord {
  id: string;
  requestId: string;
  type: string;
  status: 'pending' | 'completed' | 'failed';
  executedAt: string;
  entityIds?: string[];
  errorCode?: string;
  details?: unknown;
}

export interface ModelRunMetadataRecord {
  id: string;
  task: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  modelId?: string;
  promptVersion?: string;
  startedAt?: string;
  completedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
}

export interface SearchOutboxRecord {
  sequence: number;
  entityId: string;
  operation: 'upsert' | 'delete';
  entityType?: 'card' | 'tag' | 'source';
  createdAt?: string;
}

/**
 * Union type covering the expected metadata value types stored in the `meta` table.
 */
export type MetaValue = string | number | boolean | null;

/**
 * LexiFlow Dexie database — v1 schema.
 * See technical-design/04 §6 for the full schema definition.
 *
 * IMPORTANT: Only infrastructure code may import this file.
 * Components, content scripts, and model adapters must use the Repository interface.
 */
export class LexiFlowDatabase extends Dexie {
  // Cards
  cards!: Table<Card, string>;
  cardContents!: Table<CardContent & { cardId: string; schemaVersion: number }, string>;

  // Sources
  sourcePages!: Table<SourcePage, string>;
  sourceCaptures!: Table<SourceCapture, string>;
  cardSourceLinks!: Table<CardSourceLink, string>;

  // Inbox
  inboxItems!: Table<InboxItem, string>;

  // Tags & Relations
  tags!: Table<Tag, string>;
  cardTags!: Table<{ cardId: string; tagId: string }, string>;
  cardRelations!: Table<CardRelation, string>;

  // Review & FSRS
  reviewEvents!: Table<ReviewEvent, string>;
  scheduleSnapshots!: Table<ScheduleSnapshot, string>;
  reviewAttemptDetails!: Table<ReviewAttemptDetail, string>;
  reviewSessions!: Table<ReviewSessionRecord, string>;

  // Errors
  errorAnnotations!: Table<ErrorAnnotation, string>;

  // Practice
  practiceSessions!: Table<PracticeSessionRecord, string>;
  practiceItems!: Table<PracticeItemRecord, string>;
  practiceAttempts!: Table<PracticeAttemptRecord, string>;

  // Operations & Metadata
  operationLogs!: Table<OperationLogRecord, string>;
  modelRunMetadata!: Table<ModelRunMetadataRecord, string>;

  // Search projection
  searchOutbox!: Table<SearchOutboxRecord, number>;
  meta!: Table<{ key: string; value: MetaValue }, string>;

  constructor() {
    super('lexiflow');

    this.version(1).stores({
      cards: 'id, [type+status], status, normalizedKey, updatedAt, *tagIds',
      cardContents: 'cardId, schemaVersion',
      sourcePages: 'id, &canonicalKey, domain, lastSeenAt',
      sourceCaptures: 'id, pageId, &captureRequestId, contentHash, capturedAt',
      cardSourceLinks: 'id, cardId, sourceCaptureId, &[cardId+sourceCaptureId+role]',
      inboxItems: 'id, status, sourceCaptureId, createdAt, updatedAt',
      tags: 'id, &normalizedName, updatedAt',
      cardTags: '&[cardId+tagId], cardId, tagId',
      cardRelations: 'id, fromCardId, toCardId, &[fromCardId+toCardId+type]',
      reviewEvents: 'eventId, cardId, &attemptId, &[cardId+sequence], occurredAt, rating',
      scheduleSnapshots: 'cardId, dueAt, lastSequence, state.state',
      reviewAttemptDetails: 'attemptId, cardId, sessionId',
      reviewSessions: 'id, status, createdAt',
      errorAnnotations: 'id, cardId, reviewEventId, type, occurredAt',
      practiceSessions: 'id, status, createdAt, completedAt',
      practiceItems: 'id, sessionId, type, *cardIds',
      practiceAttempts: 'id, itemId, createdAt, outcome',
      operationLogs: 'id, &requestId, type, status, executedAt',
      modelRunMetadata: 'id, task, status, startedAt',
      searchOutbox: '++sequence, entityId, operation',
      meta: 'key',
    });
  }
}

/**
 * Singleton database instance.
 * In tests, fake-indexeddb auto-mocks IndexedDB.
 */
export const db = new LexiFlowDatabase();
