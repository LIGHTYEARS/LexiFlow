import { getSettings } from '@infra/storage/settings-gateway';
import {
  saveCaptureTransaction,
  createCardTransaction,
  appendSourceToCard,
  computeContentHash,
} from '@infra/db/transactions';
import { getSourceCaptureByRequestId, getCard } from '@infra/db/repository-impl';
import { db } from '@infra/db/database';
import { computeDedupSuggestions, hasExactDuplicate } from '@app/dedup/dedup-service';
import { enqueueSearchUpsert } from '@app/search/search-index';
import { canonicalizeUrl } from '@shared/utils/url';
import type { SourceCapture } from '@domain/source/source.model';
import type { Card } from '@domain/card/card.model';
import type { SaveCaptureResult, DedupSuggestion } from '@shared/protocol/protocol-map';

/**
 * CaptureService — orchestrates save-before-dedup and routing per PRD §9-10.
 * Uses the (previously orphaned) idempotent transactions in the repository.
 *
 * Routing:
 *  - exact duplicate + skipExactDuplicate → skip (§10.1)
 *  - explicit save-to-inbox, or destination=inbox, or any ambiguity → Inbox
 *  - destination=library + no blocking dup + a usable draft → new card
 */

export interface SaveCaptureParams {
  requestId: string;
  selectedText: string;
  context: SourceCapture['context'];
  pageUrl: string;
  pageTitle: string;
  siteName?: string;
  domain: string;
  requestedAction: 'save' | 'save-to-inbox';
  /** Optional model-derived draft for direct-to-library saves. */
  draft?: {
    type: Card['type'];
    headword: string;
    explanations?: Array<{ value: string; origin: Card['headword']['origin'] }>;
    examples?: Array<{ value: string; origin: Card['headword']['origin'] }>;
  };
}

export async function saveCapture(params: SaveCaptureParams): Promise<SaveCaptureResult> {
  // Idempotency: if this requestId already produced a capture, return same result.
  const existing = await getSourceCaptureByRequestId(params.requestId);
  if (existing) {
    return resultForExistingCapture(existing.id);
  }

  const settings = await getSettings();
  const contentHash = computeContentHash(params.selectedText);
  const canonicalKey = canonicalizeUrl(params.pageUrl);
  const existingPage = await db.sourcePages.get({ canonicalKey });

  // Dedup judgment (§9.1).
  const suggestions = await computeDedupSuggestions({
    selectedText: params.selectedText,
    contentHash,
    pageId: existingPage?.id,
  });

  // Auto-skip only exact duplicates when the user enabled it (§10.1).
  const exact = hasExactDuplicate(suggestions);
  if (exact && settings.automation.skipExactDuplicate && params.requestedAction === 'save') {
    return {
      captureId: '',
      status: 'skipped',
      cardId: exact.candidateCardId,
      message: 'Skipped — this exact content is already saved.',
    };
  }

  // Decide destination.
  const wantsLibrary =
    params.requestedAction === 'save' &&
    settings.automation.newCaptureDestination === 'library' &&
    !settings.automation.requireConfirmationForAllWrites &&
    suggestions.length === 0 &&
    !!params.draft;

  // Always persist the immutable capture first (this creates an Inbox item too).
  const saveResult = await saveCaptureTransaction({
    requestId: params.requestId,
    selectedText: params.selectedText,
    context: params.context,
    pageUrl: params.pageUrl,
    pageTitle: params.pageTitle,
    siteName: params.siteName,
    domain: params.domain,
    requestedAction: params.requestedAction,
  });

  // Attach dedup suggestions to the created inbox item so triage can show them.
  if (suggestions.length > 0) {
    await attachSuggestions(saveResult.captureId, suggestions);
  }

  if (wantsLibrary && params.draft) {
    // Promote straight to a card and remove the inbox placeholder.
    const card = await createCardTransaction({
      requestId: params.requestId + ':card',
      type: params.draft.type,
      headword: params.draft.headword,
      explanations: params.draft.explanations ?? [],
      examples: params.draft.examples ?? [],
      sourceCaptureId: saveResult.captureId,
    });
    await resolveInboxForCapture(saveResult.captureId);
    await enqueueSearchUpsert(card.id);
    return {
      captureId: saveResult.captureId,
      status: 'new-card',
      cardId: card.id,
      message: 'Saved as a new card.',
    };
  }

  return {
    captureId: saveResult.captureId,
    status: 'inbox',
    message:
      suggestions.length > 0
        ? 'Saved to Inbox — similar cards found, please review.'
        : 'Saved to Inbox for review.',
  };
}

async function attachSuggestions(captureId: string, suggestions: DedupSuggestion[]): Promise<void> {
  const item = await db.inboxItems.where('sourceCaptureId').equals(captureId).first();
  if (!item) return;
  await db.inboxItems.update(item.id, {
    suggestions: suggestions.map((s) => ({
      id: crypto.randomUUID(),
      type: s.relationType ?? 'related',
      confidence: s.confidence,
      targetCardId: s.candidateCardId,
      rationale: s.rationale,
    })),
    updatedAt: new Date().toISOString(),
  });
}

async function resolveInboxForCapture(captureId: string): Promise<void> {
  const item = await db.inboxItems.where('sourceCaptureId').equals(captureId).first();
  if (item) {
    await db.inboxItems.update(item.id, { status: 'resolved', updatedAt: new Date().toISOString() });
  }
}

async function resultForExistingCapture(captureId: string): Promise<SaveCaptureResult> {
  const link = await db.cardSourceLinks.where('sourceCaptureId').equals(captureId).first();
  if (link) {
    return { captureId, status: 'appended', cardId: link.cardId, message: 'Already saved (idempotent).' };
  }
  return { captureId, status: 'inbox', message: 'Already in Inbox (idempotent).' };
}

export { appendSourceToCard, getCard };
