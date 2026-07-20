# LexiFlow Type-Safety Issues

> **Status Legend:** `pending` — issue identified, not yet addressed.
>
> This document records type-safety issues found across the entire codebase. Each issue is categorized by type and marked as `pending`. Issues are grouped by source layer for triage.

---

## Summary

| Category | Count |
|---|---|
| Inconsistent types between related schemas/interfaces/implementations | 31 |
| `unknown`/`any` types that should be typed | 34 |
| Type assertions (`as` casts) bypassing type checking | 26 |
| Missing null checks where types allow null/undefined | 17 |
| Unused types (defined but never referenced) | 9 |
| Loose `string` where enum/literal union is expected | 16 |
| Missing type annotations on function parameters/variables | 12 |
| Test mock types not matching real types | 10 |
| Utility types too loose (`Record<string, unknown>`) | 4 |
| Missing return type annotations | 12 |
| Promise/error handling gaps | 5 |
| Unchecked indexed access | 2 |
| **Total** | **220** |

---

## 1. `unknown` / `any` Types That Should Be Typed (34)

### 1.1 Domain Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| U-01 | `src/domain/card/card.model.ts` | 64 | `WordContentSchema.senses` uses `z.array(z.unknown())` — zero type safety for word senses | fixed |
| U-02 | `src/domain/inbox/inbox.model.ts` | 12 | `InboxItemSchema.draft` uses `z.unknown().optional()` — no validation or type safety | fixed |
| U-03 | `src/domain/inbox/inbox.model.ts` | 13 | `InboxItemSchema.suggestions` uses `z.array(z.unknown()).optional()` — no validation | fixed |

### 1.2 Infrastructure Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| U-04 | `src/infrastructure/db/database.ts` | 47 | `reviewSessions` table typed as `Table<Record<string, unknown>, string>` — no ReviewSession model | fixed |
| U-05 | `src/infrastructure/db/database.ts` | 53 | `practiceSessions` table typed as `Table<Record<string, unknown>, string>` — untyped | fixed |
| U-06 | `src/infrastructure/db/database.ts` | 54 | `practiceItems` table typed as `Table<Record<string, unknown>, string>` — untyped | fixed |
| U-07 | `src/infrastructure/db/database.ts` | 55 | `practiceAttempts` table typed as `Table<Record<string, unknown>, string>` — untyped | fixed |
| U-08 | `src/infrastructure/db/database.ts` | 58 | `operationLogs` table typed as `Table<Record<string, unknown>, string>` — untyped | fixed |
| U-09 | `src/infrastructure/db/database.ts` | 59 | `modelRunMetadata` table typed as `Table<Record<string, unknown>, string>` — untyped | fixed |
| U-10 | `src/infrastructure/db/database.ts` | 62 | `searchOutbox` table typed as `Table<Record<string, unknown>, number>` — untyped | fixed |
| U-11 | `src/infrastructure/db/database.ts` | 63 | `meta` table has `value: unknown` — no type safety on metadata values | fixed |
| U-12 | `src/infrastructure/db/repository.ts` | 21 | `getInboxItems` returns `items: unknown[]` instead of `InboxItem[]` | fixed |
| U-13 | `src/infrastructure/db/repository.ts` | 68 | `ReviseCardCommand.patch` is `Record<string, unknown>` instead of `Partial<Card>` | fixed |
| U-14 | `src/infrastructure/db/repository.ts` | 101 | `ApplyPlanCommand.operations` is `unknown[]` — no operation type defined | fixed |
| U-15 | `src/infrastructure/db/migrations.ts` | 67 | `(error as Error).message` — casts `unknown` to `Error` without `instanceof` check | fixed |
| U-16 | `src/infrastructure/storage/settings-gateway.ts` | 35 | `result[SETTINGS_KEY]` is implicitly `any` from Chrome storage API | fixed |
| U-17 | `src/infrastructure/storage/settings-gateway.ts` | 157 | `result[CREDENTIALS_KEY] as Credential` — no runtime validation against `CredentialSchema` | fixed |
| U-18 | `src/infrastructure/storage/settings-gateway.ts` | 173 | `result[CREDENTIALS_KEY]` is implicitly `any` | fixed |
| U-19 | `src/infrastructure/storage/settings-gateway.ts` | 196 | `result[SCHEMA_VERSION_KEY]` is implicitly `any` — string values returned as `number` | fixed |
| U-20 | `src/infrastructure/messaging/message-registry.ts` | 8-12 | `MessageHandler<TInput=unknown, TOutput=unknown>` defaults lose all type info | fixed |
| U-21 | `src/infrastructure/messaging/message-registry.ts` | 19 | `Map<string, MessageHandler>` uses default `unknown` generics | fixed |
| U-22 | `src/infrastructure/messaging/message-registry.ts` | 55 | `handle` returns `Promise<AppResult<unknown>>` — actual output type lost | fixed |

### 1.3 Shared & Protocol Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| U-23 | `src/shared/protocol/envelope.ts` | 14 | `payload: z.unknown()` — message payloads never validated or narrowed at boundary | fixed |
| U-24 | `src/shared/protocol/envelope.ts` | 109 | `validateEnvelope` returns `MessageEnvelope` with default `unknown` payload | fixed |
| U-25 | `src/shared/protocol/protocol-map.ts` | 142 | `suggestions: unknown[]` in `DedupPreview` — untyped array | fixed |
| U-26 | `src/shared/protocol/protocol-map.ts` | 159 | `items: unknown[]` in `InboxBatchPreview` — untyped array | fixed |
| U-27 | `src/shared/protocol/protocol-map.ts` | 170 | `results: unknown[]` in `InboxBatchResult` — untyped array | fixed |
| U-28 | `src/shared/protocol/protocol-map.ts` | 181 | `items: unknown[]` in `SearchResult` — untyped array | fixed |
| U-29 | `src/shared/protocol/protocol-map.ts` | 191-196 | `explanations`, `examples`, `sources`, `tags`, `relations` all `unknown[]` in `CardDetail` | fixed |
| U-30 | `src/shared/protocol/protocol-map.ts` | 196 | `reviewState?: unknown` in `CardDetail` — untyped | fixed |
| U-31 | `src/shared/protocol/protocol-map.ts` | 323 | `context?: ReviewRevealContext` in `ReviewReveal` — typed with `sentenceContaining?`, `paragraphExcerpt?`, `pageTitle?`, `url?` | fixed |
| U-32 | `src/shared/protocol/protocol-map.ts` | 363 | `newState?: RebuildStateInfo` in `RebuildReport` — typed with `dueAt`, `state`, `stability`, `difficulty` | fixed |
| U-33 | `src/shared/protocol/protocol-map.ts` | 276-277 | `page: SourcePageSummary` and `cards: SourcePageCard[]` in `SourcePageResult` — typed | fixed |
| U-34 | `src/shared/protocol/protocol-map.ts` | 375 | `impacts: FsrsImpact[]` in `FsrsImpactPreview` — typed with `cardId`, `currentDueAt`, `newDueAt`, `rating` enum | fixed |

---

## 2. Inconsistent Types Between Related Schemas / Interfaces / Implementations (31)

### 2.1 Domain Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| I-01 | `src/domain/card/card.model.ts` | 8-15, 77-81 | Shared `ProvenancedTextSchema` used for `headword`, `explanations`, `examples`, `notes` — no inline duplication | fixed |
| I-02 | `src/domain/card/card.model.ts` | 10, 73, 75 | `// Keep in sync with ... in ../types.ts` comments on `z.enum` calls for `ContentOrigin`, `CardType`, `CardStatus` | fixed |
| I-03 | `src/domain/card/card.model.ts` | 57-62, 82 | `CardContentSchema` defined before `CardSchema` and attached via `content: CardContentSchema.optional()` | fixed |
| I-04 | `src/domain/source/source.model.ts` | 36 | `SourceCaptureSchema.context.url` uses `z.string().url()` — consistent with `SourcePageSchema.url` | fixed |
| I-05 | `src/domain/source/source.model.ts` | 37 | `SourceCaptureSchema.context.canonicalUrl` uses `z.string().url().optional()` — consistent with `SourcePageSchema.url` | fixed |
| I-06 | `src/domain/source/source.model.ts` | 45 | `SourceCaptureSchema.captureRequestId` uses `z.string().uuid()` — consistent with `id` and `pageId` | fixed |
| I-07 | `src/domain/review/review.model.ts` | 14-15 | `elapsedDays`/`scheduledDays` use `z.number()` without `.int()` but `reps`/`lapses` use `.int()` — inconsistent | fixed |
| I-08 | `src/domain/review/review.model.ts` | 53 | `ScheduleSnapshotSchema.lastSequence` uses `.int()` without `.positive()` but `ReviewEventSchema.sequence` uses `.positive()` | fixed |
| I-09 | `src/domain/review/review.model.ts` | 75-76 | `suggestedErrorTypes`/`confirmedErrorTypes` use `z.array(z.string())` instead of `z.array(z.enum(ERROR_TYPES))` | fixed |
| I-10 | `src/domain/review/review.model.ts` | 72 | `referenceAnswerRef` uses `z.string().optional()` without UUID validation | fixed |
| I-11 | `src/domain/review/review.model.ts` | 73 | `durationMs` uses `.int().optional()` without `.positive()` — duration cannot be zero/negative | fixed |
| I-12 | `src/domain/error/error.model.ts` | 13 | `ErrorAnnotationSchema.type` uses `z.string()` instead of `z.enum(ERROR_TYPES)` — allows any string | fixed |
| I-13 | `src/domain/error/error.model.ts` | 14 | `ErrorAnnotationSchema.userOverride` uses `z.string().optional()` — should be `ErrorType` enum | fixed |
| I-14 | `src/domain/tag/tag.model.ts` | 25-35 | `CardRelationSchema` redefines `CardRelationType`, `RelationDirection`, `ContentOrigin` inline with `z.enum()` | fixed |
| I-15 | `src/domain/types.ts` | 38 | `ProvenancedText.sourceCaptureId`/`modelRunId` typed as plain `string` but schema validates as `.uuid()` — TS type wider than schema permits | fixed |

### 2.2 Infrastructure Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| I-16 | `src/infrastructure/db/repository.ts` | 9-31 | `KnowledgeRepository` interface declares methods (`saveCapture`, `recordReview`, `applyOrganizationPlan`) not implemented by any class | fixed |
| I-17 | `src/infrastructure/db/repository.ts` | 42-47 | `SaveCaptureResult` and `SaveCaptureOutput` (transactions.ts) are duplicate types with identical shapes | fixed |
| I-18 | `src/infrastructure/db/repository.ts` | 35-40 | `SaveCaptureCommand` has `selectionSnapshotId`/`idempotencyKey` but `SaveCaptureInput` (transactions.ts) has completely different fields | fixed |
| I-19 | `src/infrastructure/db/repository.ts` | 72-81 | `RecordReviewCommand` missing `previousStateHash`, `resultingState`, `confirmedErrorTypes` that `RecordReviewInput` requires | fixed |
| I-20 | `src/infrastructure/db/repository.ts` | 96 | `DueCardsResult.cards` includes `attemptId` but implementation does not return it | fixed |
| I-21 | `src/infrastructure/db/repository-impl.ts` | 98-104 | `queryCards` parameter type missing `sourceDomain` and `search` from `CardQuery` interface | fixed |
| I-22 | `src/infrastructure/db/repository-impl.ts` | 148-152 | `reviseCard` uses `patch: Partial<Card>` but interface uses `Record<string, unknown>`; missing `confirmationToken` | fixed |
| I-23 | `src/infrastructure/db/repository-impl.ts` | 220-241 | `getInboxItems` returns `InboxItem[]` but interface declares `unknown[]` | fixed |
| I-24 | `src/infrastructure/db/repository-impl.ts` | 265-299 | `getDueCards` returns bare array without `attemptId`, but interface wraps in object with `attemptId` | fixed |
| I-25 | `src/infrastructure/db/transactions.ts` | 346 | `mode: input.mode as ReviewEvent['mode']` — `input.mode` is `string` cast to enum without validation | fixed |
| I-26 | `src/infrastructure/db/transactions.ts` | 371 | `parameterSetId: input.resultingState.schedulerVersion` — assigns `schedulerVersion` to `parameterSetId` (semantic mismatch) | fixed |
| I-27 | `src/infrastructure/storage/settings-schema.ts` | 8-30 | `UserSettingsSchema` and `UserSettingsView` (protocol-map.ts) have different structures (e.g., `hasCredential` in view not in schema) | fixed |
| I-28 | `src/infrastructure/db/repository-impl.ts` | 408-409 | `getSourcePages` maps `lastSeenAt` to `lastCapturedAt` — misleading field name | fixed |

### 2.3 Application Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| I-29 | `src/application/core/handlers.ts` | 38-45 | `settings/get` returns `{ ...settings, model: { ... } }` which includes `credentialRef` — not part of `UserSettingsView` and should never be exposed | fixed |
| I-30 | `src/application/core/handlers.ts` | 134 | `page/summary` handler reads `url` from payload but `PageSummaryQuery` defines field as `pageUrl` — field name mismatch | fixed |
| I-31 | `src/application/core/handlers.ts` | 135-141 | `page/summary` handler returns `url` but `PageSummary` type defines `pageUrl` — consumers get `undefined` | fixed |

---

## 3. Type Assertions (`as` Casts) Bypassing Type Checking (26)

### 3.1 Content-UI Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| A-01 | `src/content-ui/selection-machine.ts` | 61 | `(event as any).snapshot` with `eslint-disable` — should narrow to `VALID_SELECTION` event type | fixed |
| A-02 | `src/content-ui/selection-machine.ts` | 77 | `(event as any).snapshot` with `eslint-disable` — same pattern in `stabilizing` state | fixed |
| A-03 | `src/content-ui/selection-machine.ts` | 107 | `(event as any).context` with `eslint-disable` — should narrow to `CONTEXT_READY` event | fixed |
| A-04 | `src/content-ui/selection-machine.ts` | 121 | `(event as any).error` with `eslint-disable` — should narrow to `EXPLAIN_FAILED` event | fixed |
| A-05 | `src/content-ui/selection-machine.ts` | 49-53 | `null as SelectionSnapshot | null` etc. — forces context type inference for XState | fixed |
| A-06 | `src/content-ui/selection-validator.ts` | 112-114 | `container as HTMLElement` — should use `instanceof HTMLElement` for proper narrowing | fixed |
| A-07 | `src/content-ui/selection-validator.ts` | 124-126 | `ancestor as HTMLElement` — same pattern | fixed |
| A-08 | `src/content-ui/context-extractor.ts` | 100 | `(ancestor as HTMLElement)` — same pattern | fixed |
| A-09 | `src/content-ui/context-extractor.ts` | 297-299 | `(range.commonAncestorContainer as HTMLElement)` — same pattern | fixed |
| A-10 | `src/content-ui/context-extractor.ts` | 321-323 | `(range.commonAncestorContainer as HTMLElement)` — same pattern | fixed |
| A-11 | `src/content-ui/context-extractor.ts` | 375 | `const element = node as HTMLElement` — same pattern | fixed |

### 3.2 Infrastructure Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| A-12 | `src/infrastructure/db/migrations.ts` | 64-67 | `error as AppError` — only checks `'code' in error`, not full `AppError` shape | fixed |
| A-13 | `src/infrastructure/db/migrations.ts` | 67 | `(error as Error).message` — casts `unknown` to `Error` without `instanceof` check | fixed |
| A-14 | `src/infrastructure/db/transactions.ts` | 346 | `mode: input.mode as ReviewEvent['mode']` — no runtime validation of enum value | fixed |
| A-15 | `src/infrastructure/messaging/browser-runtime.ts` | 85 | `response as TResponse` — no runtime validation of response shape from `sendMessage` | fixed |
| A-16 | `src/infrastructure/messaging/browser-runtime.ts` | 107 | `response as TResponse` — same issue for `sendMessageToTab` | fixed |
| A-17 | `src/infrastructure/messaging/message-registry.ts` | 31 | `handler as MessageHandler` — discards handler's specific input/output types | fixed |
| A-18 | `src/infrastructure/messaging/message-registry.ts` | 61 | `error as AppError` — assumes `validateEnvelope` always throws `AppError` | fixed |
| A-19 | `src/infrastructure/storage/settings-gateway.ts` | 157 | `result[CREDENTIALS_KEY] as Credential` — no runtime schema validation | fixed |

### 3.3 Application & Entrypoint Layer

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| A-20 | `src/application/core/handlers.ts` | 20 | `payload as { origin: string }` — bypasses type checking on `unknown` payload | fixed |
| A-21 | `src/application/core/handlers.ts` | 50 | `payload as { url: string; tabId?: number }` — bypasses type checking | fixed |
| A-22 | `src/application/core/handlers.ts` | 81 | `payload as { url: string }` — bypasses type checking | fixed |
| A-23 | `src/application/core/handlers.ts` | 93 | `payload as { url: string }` — bypasses type checking | fixed |
| A-24 | `src/application/core/handlers.ts` | 104 | `payload as { destination: string; tabId?: number }` — wider than `ProtocolMap` literal union | fixed |
| A-25 | `src/application/core/handlers.ts` | 118 | `undefined as unknown` — unnecessary assertion; should return `undefined` directly | fixed |
| A-26 | `src/application/core/handlers.ts` | 134 | `payload as { url?: string }` — field name mismatch with `ProtocolMap` | fixed |

---

## 4. Missing Null Checks Where Types Allow Null/Undefined (17)

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| N-01 | `src/shared/protocol/page-session.ts` | 25 | `url.split('#')[0]` can return empty string if URL starts with `#` | fixed |
| N-02 | `src/shared/utils/date.ts` | 25-28 | `isDue` returns `false` for both invalid dates and future dates — indistinguishable | fixed |
| N-03 | `src/shared/utils/date.ts` | 44 | `formatDuration` does not handle `NaN` or negative values | fixed |
| N-04 | `src/shared/utils/url.ts` | 27 | `canonicalizeUrl` returns original URL silently on parse failure | fixed |
| N-05 | `src/shared/utils/url.ts` | 71 | `removeFragment` returns original URL silently on parse failure | fixed |
| N-06 | `src/infrastructure/messaging/browser-runtime.ts` | 43-59 | `JSON.stringify(payload ?? '')` can throw on circular refs or `BigInt` — no try-catch | fixed |
| N-07 | `src/infrastructure/messaging/browser-runtime.ts` | 81 | `throw sizeCheck.error` — `error` is `AppError | undefined` per return type | fixed |
| N-08 | `src/infrastructure/messaging/message-registry.ts` | 67, 73 | `senderCheck.error!` and `sizeCheck.error!` — non-null assertions on optional properties | fixed |
| N-09 | `src/infrastructure/permissions/model-origin-gateway.ts` | 15-18 | `validateModelBaseUrl` returns `{ valid, origin? }` — not a discriminated union; `origin` may be undefined when `valid` is true | fixed |
| N-10 | `src/infrastructure/permissions/model-origin-gateway.ts` | 131-138 | `canMakeModelRequest` returns `{ allowed, error? }` — `error` may be undefined when `allowed` is false | fixed |
| N-11 | `src/infrastructure/db/repository-impl.ts` | 131, 235, 389 | `parseInt(query.cursor, 10)` — no validation for `NaN`; produces incorrect pagination | fixed |
| N-12 | `src/infrastructure/db/repository-impl.ts` | 122 | `query.tagIds!.every(...)` — non-null assertion inside closure; narrowing doesn't persist | fixed |
| N-13 | `src/infrastructure/storage/settings-gateway.ts` | 157-159 | After cast, `credential.id`/`credential.encryptedValue` may be `undefined` if stored data is corrupted | fixed |
| N-14 | `src/infrastructure/storage/settings-schema.ts` | 50-52 | `DEFAULT_SETTINGS.review` missing `reminderTime` — callers get `undefined` | fixed |
| N-15 | `src/infrastructure/db/migrations.ts` | 63-69 | `(error as Error).message` may be `undefined` → produces `"Migration failed: undefined"` | fixed |
| N-16 | `tests/integration/repository.test.ts` | 231 | `result.nextCursor` is `string | undefined` passed directly to `queryCards` | fixed |
| N-17 | `src/content-ui/selection-validator.ts` | 199 | `rects[0]` typed as non-nullable but can be `undefined` at runtime | fixed |

---

## 5. Loose `string` Where Enum / Literal Union Is Expected (16)

All in `src/shared/protocol/protocol-map.ts` unless noted:

| ID | File | Line(s) | Field | Should be | Status |
|---|---|---|---|---|---|
| S-01 | protocol-map.ts | 148 | `action: string` in `ApplyDecisionCommand` | literal union of action types | fixed |
| S-02 | protocol-map.ts | 154 | `proposedAction: string` in `InboxBatchPreviewCommand` | literal union of action types | fixed |
| S-03 | protocol-map.ts | 188 | `type: string` in `CardDetail` | `CardType` enum | fixed |
| S-04 | protocol-map.ts | 189 | `status: string` in `CardDetail` | `CardStatus` enum | fixed |
| S-05 | protocol-map.ts | 243 | `modes?: string[]` in `CreateReviewSessionCommand` | array of mode literals | fixed |
| S-06 | protocol-map.ts | 255 | `mode: string` in `ReviewItem` | review mode literal union | fixed |
| S-07 | protocol-map.ts | 269 | `state: string` in `RatingPreview` | FSRS state literal union | fixed |
| S-08 | protocol-map.ts | 281 | `state: string` in `ReviewCommitResult` | FSRS state literal union | fixed |
| S-09 | protocol-map.ts | 286 | `confirmedTypes: string[]` in `AnnotateErrorCommand` | `ErrorType[]` enum array | fixed |
| S-10 | protocol-map.ts | 308 | `type: string` in `AiTaskRequest` | task type literal union | fixed |
| S-11 | protocol-map.ts | 316 | `state: string` in `AiTaskSnapshot` | task state literal union | fixed |
| S-12 | protocol-map.ts | 345 | `newCaptureDestination: string` in `UserSettingsView` | destination literal union | fixed |
| S-13 | content-ui/ExplanationPopover.tsx | 17 | `type?: string` | `CardType` literal union | fixed |
| S-14 | content-ui/ExplanationPopover.tsx | 24 | `relation: string` | `CardRelationType` literal union | fixed |
| S-15 | application/core/handlers.ts | 104 | `destination: string` (cast) | `ProtocolMap` literal union `'dashboard'|'review'|'inbox'|'settings'` | fixed |
| S-16 | domain/inbox/inbox.model.ts | 14-20 | `failure.code` uses `z.string()` — should be error-code enum | fixed |

---

## 6. Unused Types (Defined in `types.ts`, Never Referenced) (9)

All in `src/domain/types.ts`:

| ID | Type | Line(s) | Description | Status |
|---|---|---|---|---|
| T-01 | `EntityId` | 8 | Never imported by any model file — all use inline `z.string().uuid()` | fixed |
| T-02 | `CardType` | 11 | Never imported — redefined inline in `card.model.ts` | fixed |
| T-03 | `CardStatus` | 14 | Never imported — redefined inline in `card.model.ts` | fixed |
| T-04 | `ContentOrigin` | 17 | Never imported — redefined inline in `card.model.ts`, `tag.model.ts` | fixed |
| T-05 | `ConfidenceLabel` | 24-28 | Never used anywhere — no schema references it | fixed |
| T-06 | `ProvenancedText` | 35-41 | Never imported — shape duplicated inline 4 times in `card.model.ts` | pending |
| T-07 | `CardRelationType` | 46-53 | Never imported — redefined inline in `tag.model.ts` | pending |
| T-08 | `RelationDirection` | 60 | Never imported — redefined inline in `tag.model.ts` | pending |
| T-09 | `CardSchema` (no link to `CardContentSchema`) | card.model.ts:88-93 | `CardContentSchema` defined but never attached to `CardSchema` | pending |

---

## 7. Missing Type Annotations on Function Parameters / Variables (12)

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| M-01 | `src/application/core/handlers.ts` | 19, 29, 49, 80, 92, 103, 122, 133 | All handler `payload`/`_payload` parameters are implicitly `unknown` | fixed |
| M-02 | `src/application/core/handlers.ts` | 101-103 | `register` called without generics — `TInput` defaults to `unknown` | fixed |
| M-03 | `tests/integration/repository.test.ts` | 42-56 | `captureInput` object has no explicit type annotation | fixed |
| M-04 | `tests/integration/repository.test.ts` | 128-129 | `explanations`/`examples` object literals have no type annotation | fixed |
| M-05 | `tests/unit/infrastructure/messaging.test.ts` | 101-103 | `payload` and `envelope` callback params have no explicit types | fixed |
| M-06 | `tests/unit/infrastructure/messaging.test.ts` | 181-182 | `register('test/a', async () => ok('1', undefined))` — no typed params | fixed |
| M-07 | `tests/unit/domain/schemas.test.ts` | 29 | Positive test cases have no explicit type annotations on object literals | fixed |
| M-08 | `entrypoints/popup/App.tsx` | 3 | `export default function App()` — missing return type annotation | fixed |
| M-09 | `entrypoints/sidepanel/App.tsx` | 3 | Missing return type annotation | fixed |
| M-10 | `entrypoints/dashboard/App.tsx` | 25 | Missing return type annotation | fixed |
| M-11 | `entrypoints/dashboard/routes/*.tsx` | 3 (all) | All 9 route components missing return type annotations | fixed |
| M-12 | `src/infrastructure/db/transactions.ts` | 176 | `origin: 'web_page'` hardcoded for headword — `CreateCardInput` doesn't allow specifying headword origin | fixed |

---

## 8. Test Mock Types Not Matching Real Types (10)

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| K-01 | `tests/unit/content-ui/selection.test.ts` | 35-39, 51-57, etc. | `as unknown as Selection` — mocks missing many required `Selection` properties | pending |
| K-02 | `tests/unit/content-ui/selection.test.ts` | 179-184, 277-280 | `as unknown as Range` — mocks missing many required `Range` properties | pending |
| K-03 | `tests/unit/content-ui/selection.test.ts` | 215-227 | `as SelectionSnapshot` — forces object literal to match type without field verification | pending |
| K-04 | `tests/unit/content-ui/selection.test.ts` | 215, 228, 235 | Bracket notation `observer['currentSnapshot']` etc. bypasses type visibility | pending |
| K-05 | `tests/unit/content-ui/selection.test.ts` | 273-274 | `getElementById('para')!` and `para.firstChild!` — non-null assertions bypass null safety | pending |
| K-06 | `tests/unit/infrastructure/messaging.test.ts` | 114, 124, 140, 156, 176, 192, 197, 203-207 | `sender as unknown as chrome.runtime.MessageSender` — mocks missing required fields | pending |
| K-07 | `tests/unit/infrastructure/settings-gateway.test.ts` | 17-19, 33-34, etc. | `as unknown as { mockResolvedValue: (v: unknown) => void }` — doesn't match real `chrome.storage.local.get` signature | pending |
| K-08 | `tests/unit/infrastructure/settings-gateway.test.ts` | 59 | `as unknown as typeof DEFAULT_SETTINGS` — double assertion to force invalid input | pending |
| K-09 | `tests/unit/infrastructure/settings-gateway.test.ts` | 125 | `saveResult.credentialRef!` — non-null assertion on `string | undefined` | pending |
| K-10 | `tests/integration/repository.test.ts` | 37-38 | `as unknown as { mockResolvedValue: (v: unknown) => void }` — doesn't match real Chrome API | pending |

---

## 9. Utility Types Too Loose (`Record<string, unknown>`) (4)

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| L-01 | `src/shared/protocol/protocol-map.ts` | 116 | `context?: Record<string, unknown>` in `ExplainSelectionCommand` — no constraint on context shape | pending |
| L-02 | `src/shared/protocol/protocol-map.ts` | 175 | `filters?: Record<string, unknown>` in `SearchCommand` — no constraint on filter keys/values | pending |
| L-03 | `src/shared/protocol/protocol-map.ts` | 205 | `patch: Record<string, unknown>` in `PreviewPatchCommand` — no constraint on patchable fields | pending |
| L-04 | `src/shared/protocol/protocol-map.ts` | 353 | `patch: Record<string, unknown>` in `SettingsUpdateCommand` — no constraint on settings fields | pending |

---

## 10. Missing Return Type Annotations (12)

All React functional components missing explicit `: React.JSX.Element` return type:

| ID | File | Line | Status |
|---|---|---|---|
| R-01 | `entrypoints/popup/App.tsx` | 3 | pending |
| R-02 | `entrypoints/sidepanel/App.tsx` | 3 | pending |
| R-03 | `entrypoints/dashboard/App.tsx` | 25 | pending |
| R-04 | `entrypoints/dashboard/routes/review.tsx` | 3 | pending |
| R-05 | `entrypoints/dashboard/routes/inbox.tsx` | 3 | pending |
| R-06 | `entrypoints/dashboard/routes/cards.tsx` | 3 | pending |
| R-07 | `entrypoints/dashboard/routes/sources.tsx` | 3 | pending |
| R-08 | `entrypoints/dashboard/routes/tags.tsx` | 3 | pending |
| R-09 | `entrypoints/dashboard/routes/errors.tsx` | 3 | pending |
| R-10 | `entrypoints/dashboard/routes/practice.tsx` | 3 | pending |
| R-11 | `entrypoints/dashboard/routes/stats.tsx` | 3 | pending |
| R-12 | `entrypoints/dashboard/routes/settings.tsx` | 3 | pending |

---

## 11. Promise / Error Handling Gaps (5)

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| P-01 | `src/infrastructure/permissions/page-access-policy.ts` | 107 | `.catch(() => {})` — swallows all errors silently on `unregisterContentScripts` | pending |
| P-02 | `src/infrastructure/permissions/page-access-policy.ts` | 118-120, 129-131, 144-146 | `console.error(...)` in catch blocks — errors logged but not propagated as `AppError` | pending |
| P-03 | `src/infrastructure/db/transactions.ts` | 80, 163, 233, 304 | `db.transaction(...)` calls have no explicit `.catch()` — raw Dexie errors propagate | pending |
| P-04 | `entrypoints/background.ts` | 42 | `rawEnvelope` parameter typed as `any` by Chrome API — no type narrowing before use | pending |
| P-05 | `entrypoints/content.tsx` | 55, 68 | `sendResponse` parameter typed as `any` by Chrome API — response not validated against `AppResult<T>` | pending |

---

## 12. Unchecked Indexed Access (2)

| ID | File | Line(s) | Description | Status |
|---|---|---|---|---|
| X-01 | `src/content-ui/selection-validator.ts` | 199 | `rects[0]` typed as non-nullable but can be `undefined` at runtime (empty array) | pending |
| X-02 | `tests/unit/content-ui/selection.test.ts` | 242-254, 295-307, 322-334 | `SelectionSnapshot` object literals not validated against full schema | pending |

---

## Cross-Cutting Concerns

### Dead Tables with No Type-Safe Accessors

The `cardContents` table (database.ts:28) and `cardTags` table (database.ts:40) are defined with typed schemas but no repository or transaction function ever reads from or writes to them. These are dead tables with no type-safe accessors.

### `KnowledgeRepository` Interface Not Implemented

The `KnowledgeRepository` interface (repository.ts) is never implemented by any class. `repository-impl.ts` exports standalone functions that partially match the interface, and `transactions.ts` exports additional functions with different names/signatures. There is no `implements KnowledgeRepository` anywhere.

### `operationLogs` Table Has No Valid `type` Enum

The `operationLogs` table accepts objects with `type: 'capture.save'`, `'card.create'`, `'card.append-source'`, `'review.record'` — but there's no `OperationLog` type or enum defining valid `type` values. Typos in the type string would not be caught.

### Messaging Layer Relies Heavily on `as` Casts

The entire messaging layer (`browser-runtime.ts`, `message-registry.ts`) uses `as` casts (`response as TResponse`, `handler as MessageHandler`, `error as AppError`) to bridge `unknown` payload types. No runtime validation is performed on message payloads after envelope validation — only the envelope structure is checked, not the payload contents.

### `settings/get` Handler Leaks `credentialRef`

The `settings/get` handler (handlers.ts:38-45) spreads `settings.model` into the response, which includes `credentialRef` — a credential reference that should never be exposed to the UI layer. The `UserSettingsView` type explicitly excludes this field.
