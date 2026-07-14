# 04 · 领域模型、本地存储与迁移

> 状态：拟实施（P0 数据基线）  
> 对应 PRD：§3.3–3.6、§8–12、§14–15、§17.2、§19–20  
> 依赖：《01 · 总体架构与技术基线》《02 · 扩展运行时与界面载体契约》  
> 本文可独立用于实现数据层、数据库 schema、事务不变量、迁移与恢复门禁。

## 1. 范围与非目标

### 1.1 范围

- 卡片、来源、Inbox、标签、关系、复习、错误、练习、操作记录的领域边界；
- Dexie 4 / IndexedDB schema、索引、Repository 和事务；
- WXT typed storage 中设置与凭证的隔离；
- 幂等写入、乐观并发、软删除与不可覆盖来源；
- schema 升级前备份、迁移验证、失败恢复和重启行为。

### 1.2 非目标

- 不定义模型如何生成解释、查重建议或练习题。
- 不定义 FSRS 参数计算细节；本文只保存调度器要求的状态和不可变复习历史。
- 不定义 CSV/Markdown 的面向人类导出映射；完整恢复格式仍需覆盖本文所有实体。
- 不实现云同步、多用户、APKG、开放表达反馈实体；候选能力确认前不得增加正式表。

## 2. 数据原则与需求映射

| PRD 原则 | 数据设计不变量 | 验证 |
|---|---|---|
| 原始证据可追溯 | `SourceCapture` 独立保存原文/页面；生成内容只能引用，不能覆盖 | 修改/重生成卡片后来源 hash 不变 |
| 用户内容优先 | 字段级 provenance；应用服务拒绝模型覆盖 user 字段 | 冲突测试返回预览而非覆盖 |
| 不确定进入 Inbox | `InboxItem` 可只有原始证据，无需完整生成结果 | 模型离线仍可事务保存 |
| 高影响操作确认 | Domain command 要求一次性 confirmation/operation plan | 无确认令牌时合并/删除失败 |
| 复习历史可追溯 | `ReviewEvent` append-only；`ScheduleSnapshot` 是可重建投影 | 重放事件不丢原历史 |
| 本地、可恢复 | 所有实体有稳定 id/schema/revision；迁移前备份与校验 | 新 profile 完整恢复验收 |
| 重试不重复 | capture/save 使用幂等 key，事务内返回原结果 | 并发/重启重复提交只一条 |

## 3. 存储分层与技术决定

### 3.1 Dexie 4 / IndexedDB

领域数据由 Dexie 管理，原因是事务、版本升级、索引、响应式查询和类型支持成熟；禁止自研 IndexedDB ORM。所有表只经 Repository 访问；React 组件、content script、模型 adapter 不得直接引用 Dexie database instance。

参考：[Dexie API Reference](https://dexie.org/docs/API-Reference)、[Dexie Version.upgrade](https://dexie.org/docs/Version/Version.upgrade())、[IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)。

### 3.2 WXT typed storage

以下小型设置进入 WXT storage：UI/复习/自动执行偏好、站点规则、LiteLLM 连接配置、提示词覆盖元数据、数据库 schema marker。领域实体、历史和批量 payload 不进入 `chrome.storage`。

启动时必须调用 `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`，因为 storage.local 默认可向 content script 暴露。凭证只可由 worker/Dashboard trusted contexts 通过 SettingsGateway 读取；content script 仅查询派生的 `SitePolicyView`。参考：[Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[WXT storage](https://wxt.dev/storage)。

### 3.3 备选与拒绝

- `chrome.storage.local` 保存全部数据：缺少适合复杂关系/历史的事务与索引，配额及写入模型不合适。
- 手写 IndexedDB：错误处理、迁移和事务维护成本高，违反 library-first。
- SQLite/WASM：当前单机扩展规模无证据支持额外体积、CSP/worker 复杂度。
- 把所有对象嵌套进一张 Card：来源、历史和关系无法独立追溯，更新放大且难以迁移。

## 4. 领域边界与共享类型

所有 id 为 `crypto.randomUUID()`；时间持久化为 ISO 8601 UTC 字符串；展示时按用户时区转换。每个可变实体具备 `revision`、`createdAt`、`updatedAt`。

```ts
type EntityId = string;
type CardType = 'word' | 'phrase' | 'sentence' | 'technical_term';
type CardStatus = 'active' | 'paused' | 'archived' | 'deleted';
type ContentOrigin = 'web_page' | 'user' | 'model' | 'import';
type ConfidenceLabel = 'exact' | 'likely_same' | 'possibly_related' |
  'insufficient_context';

type ProvenancedText = {
  value: string;
  origin: ContentOrigin;
  sourceCaptureId?: EntityId;
  modelRunId?: EntityId;
  editedAt?: string;
};
```

严禁使用伪精确的 `confidence: 0.873` 作为用户决策依据；可内部保留可校准信号，但 UI/操作计划必须有 `ConfidenceLabel + reasons[]`。

## 5. 核心实体契约

### 5.1 Card

```ts
type Card = {
  id: EntityId;
  revision: number;
  type: CardType;
  status: CardStatus;
  headword: ProvenancedText;
  normalizedKey: string;             // 检索候选，不代表相同义项
  explanations: ProvenancedText[];
  examples: ProvenancedText[];
  notes: ProvenancedText[];
  tagIds: EntityId[];                 // 写入时去重、排序
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

四种类型共享壳，但类型特有内容放入经 Zod discriminated union 验证的 `details`：word（lemma/partOfSpeech/pronunciation/senses）、phrase（register/patterns/collocations）、sentence（translation/reusableStructure/imitationExamples）、technical_term（domain/relatedConcepts/commonConfusions）。不适用字段缺省，不用空字符串填充。

`normalizedKey` 仅进行 Unicode NFKC、trim、空白折叠和英语大小写折叠，用于召回重复候选；不得因 key 相同自动合并义项。

### 5.2 SourcePage 与 SourceCapture

```ts
type SourcePage = {
  id: EntityId;
  canonicalKey: string;
  url: string;
  title: string;
  siteName?: string;
  domain: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

type SourceCapture = {
  id: EntityId;
  pageId: EntityId;
  selectedText: string;
  context: ContextEvidenceSnapshot;
  capturedAt: string;
  contentHash: string;
  captureRequestId: string;
};

type CardSourceLink = {
  id: EntityId;
  cardId: EntityId;
  sourceCaptureId: EntityId;
  role: 'origin' | 'additional_context' | 'example';
  createdAt: string;
};
```

SourceCapture 是采集时证据快照；后续页面变化不回写。用户可删除来源，但必须预览影响，且不能把模型文本迁入 `selectedText` 冒充来源。URL canonical key 用确定性规则去 fragment、规范 host/默认端口；query 默认保留，只有已审阅的 tracking 参数列表可去除。

### 5.3 InboxItem

```ts
type InboxItem = {
  id: EntityId;
  revision: number;
  status: 'pending' | 'processing' | 'resolved' | 'discarded';
  sourceCaptureId: EntityId;
  draft?: CardDraft;
  suggestions: OrganizationSuggestion[];
  failure?: { code: string; userMessage: string; retryable: boolean };
  resolvedByOperationId?: EntityId;
  createdAt: string;
  updatedAt: string;
};
```

原始 source 必须先于/同于 Inbox 事务提交；模型失败时 `draft` 可空。丢弃只改变状态并记录操作，按保留策略后再物理清理。

### 5.4 Tag 与 CardRelation

```ts
type Tag = { id: EntityId; name: string; normalizedName: string; revision: number; createdAt: string; updatedAt: string };
type CardRelation = {
  id: EntityId;
  fromCardId: EntityId;
  toCardId: EntityId;
  type: 'variant' | 'synonym' | 'antonym' | 'confusable' |
        'word_family' | 'pattern_usage' | 'related';
  direction: 'directed' | 'symmetric';
  origin: ContentOrigin;
  note?: string;
  createdAt: string;
};
```

relation 唯一键为语义规范化后的 `(from,to,type)`；对称关系将较小 id 放前。`related` 永远不能作为自动合并理由。删除标签不删卡片；合并标签在事务内更新所有 Card 并记录 undo patch。

### 5.5 ReviewEvent 与 ScheduleSnapshot

```ts
type FsrsStateDto = {
  schedulerVersion: string;
  state: 'new' | 'learning' | 'review' | 'relearning';
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: string;
};

type ReviewEvent = {
  eventId: EntityId;
  cardId: EntityId;
  sequence: number;
  sessionId: EntityId;
  attemptId: EntityId;
  occurredAt: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  previousStateHash: string;
  resultingState: FsrsStateDto;
  mode: 'quick' | 'input' | 'cloze' | 'imitation' | 'distinction';
  source: 'review' | 'practice-confirmed';
};

type ScheduleSnapshot = {
  cardId: EntityId;
  lastSequence: number;
  state: FsrsStateDto;
  dueAt: string;
  stateHash: string;
  schedulerVersion: string;
  parameterSetId: string;
};
```

一次 review 事务原子写入 append-only `ReviewEvent`、独立的 `ReviewAttemptDetail` 和 `ScheduleSnapshot` 投影；`attemptId` 唯一，重试返回原事件。暂停/归档不删除 schedule。专项练习默认只写 PracticeAttempt，不产生 ReviewEvent；只有显式确认的桥接操作才允许写入 `source='practice-confirmed'` 事件。

### 5.6 ErrorAnnotation、PracticeSession 与 OperationLog

- `ErrorAnnotation`：关联 review/practice、错误类型、用户覆盖、笔记；系统建议和用户确认分字段保存。
- `PracticeSession/PracticeItem/PracticeAttempt`：题源 cardIds、题型、答案/参考、结果；默认 `schedulePolicy='history-only'`，只有显式 review command 才能桥接到 FSRS。
- `OperationLog`：命令类型、影响实体、用户确认、逐项结果、可撤销 patch、执行时间；不得保存凭证或不必要的完整模型 payload。
- `ModelRunMetadata`：task、provider/model、promptVersion、状态、耗时、错误分类和输出 hash；完整模型输出只在对应实体确有产品价值时存储。

## 6. Dexie schema v1

```ts
db.version(1).stores({
  cards:              'id, [type+status], status, normalizedKey, updatedAt, *tagIds',
  sourcePages:        'id, &canonicalKey, domain, lastSeenAt',
  sourceCaptures:     'id, pageId, &captureRequestId, contentHash, capturedAt',
  cardSourceLinks:    'id, cardId, sourceCaptureId, &[cardId+sourceCaptureId+role]',
  inboxItems:         'id, status, sourceCaptureId, createdAt, updatedAt',
  tags:               'id, &normalizedName, updatedAt',
  cardRelations:      'id, fromCardId, toCardId, &[fromCardId+toCardId+type]',
  reviewEvents:       'eventId, cardId, &attemptId, &[cardId+sequence], occurredAt, rating',
  scheduleSnapshots:  'cardId, dueAt, lastSequence, state.state',
  reviewAttemptDetails:'attemptId, cardId, sessionId',
  errorAnnotations:   'id, cardId, reviewEventId, type, occurredAt',
  practiceSessions:   'id, status, createdAt, completedAt',
  practiceItems:      'id, sessionId, type, *cardIds',
  practiceAttempts:   'id, itemId, createdAt, outcome',
  operationLogs:      'id, &requestId, type, status, executedAt, undoExpiresAt',
  modelRunMetadata:   'id, task, status, startedAt'
});
```

复合/嵌套索引须在目标 Dexie/Chrome 版本运行实测；`ScheduleSnapshot.dueAt` 是今日队列的顶层索引投影，并以 invariant test 确保它与最新 ReviewEvent 同事务同步。全文搜索使用独立成熟索引方案，Dexie `normalizedKey` 只承担精确/前缀候选。

## 7. Repository 与事务边界

公开端口只暴露领域 DTO 和命令：

```ts
interface KnowledgeRepository {
  saveCapture(command: SaveCaptureCommand): Promise<SaveCaptureResult>;
  reviseCard(command: ReviseCardCommand): Promise<Card>;
  applyOrganizationPlan(command: ApplyPlanCommand): Promise<OperationResult>;
  recordReview(command: RecordReviewCommand): Promise<ReviewResult>;
  queryCards(query: CardQuery): Promise<Page<CardSummary>>;
}
```

### 7.1 必须原子的事务

- 保存 Inbox：upsert SourcePage → insert SourceCapture → insert InboxItem → OperationLog。
- 新建卡片：SourceCapture/Link + Card + OperationLog。
- 追加上下文：新的 SourceCapture + 唯一 Link + Card revision + OperationLog。
- 复习：ReviewEvent + ReviewAttemptDetail + ScheduleSnapshot 投影 + 可选 ErrorAnnotation。
- 批量整理：一个 operation header + 每项独立结果；低风险同类可按小批事务执行，不能因一项失败伪装全成功。
- 撤销：验证 revision/precondition 后应用 inverse patch 并写新 OperationLog，不删除原日志。

Dexie transaction scope 内不得等待模型/网络或用户确认。所有外部输入先准备 plan，确认后再执行短事务。

## 8. 幂等、并发与删除语义

### 8.1 幂等

- `captureRequestId`、ReviewEvent 的 `attemptId`、`OperationLog.requestId` 均有唯一索引。
- 同 id + 同 payload hash：返回首次结果；同 id + 不同 hash：返回 `CONFLICT`。
- `contentHash` 仅辅助提示/去重，不能替代 request id，也不能凭 hash 自动合并不同来源。

### 8.2 乐观并发

编辑/批量 plan 携带 `expectedRevision`。不相等时返回当前版本和 diff，不做 last-write-wins。用户手写字段与模型建议冲突时必须预览；自动追加只允许 source link 等 PRD 明确的低风险字段。

### 8.3 删除

- Card 首先软删除：`status=deleted/deletedAt`，保留历史、来源和可恢复窗口。
- 永久清理只由用户在影响预览与备份后执行，且写 OperationLog。
- SourceCapture 被多实体引用时不得物理删除；先解除引用或保留孤立证据。
- 删除标签只移除 tag link；不得 cascade 删除 Card。
- ReviewEvent 默认 append-only；ErrorAnnotation 以 revision 留存修改轨迹，二者均不因卡片归档而删除。

## 9. 设置 schema

使用 `storage.defineItem` 声明 schema、默认值、fallback 与迁移：

```ts
type UserSettings = {
  schemaVersion: 1;
  selection: { autoExplain: false; disabledSites: string[] };
  automation: {
    skipExactDuplicate: boolean;
    appendExactContext: boolean;
    newCaptureDestination: 'inbox' | 'library';
    requireConfirmationForAllWrites: boolean;
  };
  review: { dailyReviewLimit: number; dailyNewLimit: number; reminderTime?: string };
  model: {
    baseUrl: string;
    credentialRef?: string;
    taskModels: Record<string, string>;
  };
};
```

凭证本体独立 key，读取 API 不返回完整 settings dump；UI 展示 `•••• + last4` 或“已设置”。导出完整备份默认不包含明文凭证；若未来允许，必须独立显式选择与加密设计。content script 只接收 `autoExplain/siteEnabled` 派生视图。

## 10. 迁移协议

### 10.1 版本规则

- Dexie version 只递增，已发布 migration 不修改；字段含义改变必须新版本。
- 每次迁移包含 `preflight → backup → upgrade → invariant verification → commit marker`。
- 大数据迁移分批但保持可恢复 checkpoint；不得在 UI thread 做无界循环。
- settings schema 与 DB schema 分别版本化，启动协调器只有在两者兼容时放行业务写入。

### 10.2 升级步骤

1. 取得单实例 migration lock；其他 surface 进入只读“正在升级”。
2. 检查空间、旧 schema、记录数量和已知不变量；不满足则不升级。
3. 使用成熟的 `dexie-export-import` 生成升级前完整备份 Blob，并写入备份 manifest/hash；禁止自研 IndexedDB 导出器。参考：[dexie-export-import](https://dexie.org/docs/ExportImport/dexie-export-import)。
4. 运行 `version(n).upgrade(tx => ...)`；转换函数必须纯确定性，不访问网络/模型。
5. 校验记录总量、外键、唯一键、provenance、ReviewEvent/ScheduleSnapshot 序列与 hash 对应关系。
6. 写 `lastSuccessfulSchemaVersion`，重新开放命令；保留备份直到用户配置的保留期结束。

### 10.3 失败与重启

- Dexie upgrade transaction 抛错：事务回滚，保留旧库和备份；展示诊断和重试/导出入口。
- worker 在迁移前/后终止：lock 带 owner/heartbeat/phase；重启检查 IndexedDB 实际版本和 commit marker，而非相信内存。
- 迁移已提交、marker 未写：运行只读 invariant verification，成功后补 marker；失败则从备份恢复到新库名并原子切换 gateway。
- 恢复不得原地覆盖唯一副本：导入 staging DB → 完整校验 → 切换 active DB pointer → 延迟清理旧库。

## 11. 查询、规模与性能预算

初始容量目标：50,000 cards、200,000 source captures、1,000,000 review events 仍可恢复和分页查询；这不是承诺的上限，而是避免全表扫描的设计基线。

| 操作 | p95 预算 | 实现约束 |
|---|---:|---|
| capture 保存事务 | ≤ 100 ms | 无网络、索引命中、短事务 |
| card id 查询 | ≤ 30 ms | primary key |
| Inbox 首屏 50 条 | ≤ 100 ms | `[status+createdAt]` 复合索引可在后续 schema 加入 |
| 今日 due 200 条 | ≤ 100 ms | dueAt 索引 + limit，不全表 filter |
| 页面来源聚合 | ≤ 150 ms | pageId/link 索引，摘要投影按需 |
| v1→v2 10 万记录迁移 | ≤ 60 s 且 UI 有阶段反馈 | 分批/checkpoint/可取消只在安全阶段 |

所有列表游标分页，不用大 offset；Repository 返回 summary DTO，详情按需读取。索引变更必须以查询计划/数据集 benchmark 证明。

## 12. 安全与隐私

- IndexedDB 与 storage 均是本地数据，不等同加密保险库；产品需提醒 Chrome profile/设备访问边界。
- 凭证不进入 IndexedDB、SourceCapture、OperationLog、错误、导出或测试 fixture。
- 导入的 JSON/Blob 先按大小、MIME、schema 和 Zod 校验；不可实例化原型、执行脚本或信任文件路径。
- URL、模型输出、用户文本作为 data 渲染；禁止保存/回放可执行 HTML。
- 数据库错误日志只含表/操作/diagnostic id，不含实体正文。
- “清空全部数据”需要二次确认、建议备份，并同时覆盖 DB、settings（凭证是否清除需明示）、搜索索引与备份。

## 13. 自动化测试

- Zod schema：四类卡 discriminated union、provenance、日期、URL、长度边界。
- Repository/fake-indexeddb：所有事务正常/中途抛错/并发 revision/重复 request id。
- Property-based invariant：无悬空 link、对称 relation 规范化、tagIds 唯一、模型不能覆盖 user origin。
- Migration fixtures：每个已发布 schema 的最小/典型/大数据/损坏样本升级至最新；旧 fixture 永久保留。
- Kill/restart：在 preflight、backup、upgrade 前后、verification、pointer switch 阶段模拟终止。
- Backup round-trip：导出 → 新 profile staging import → entity counts/hash/invariants 相同；凭证默认不存在。
- 性能基准：使用合成大数据测保存、due、Inbox、页面聚合和迁移 p50/p95。
- Static rule：只有 infrastructure repository 文件可导入 Dexie；content script 构建不得包含 credential schema。

## 14. 逐步人工验收

1. 在全新 profile 启动，创建四类卡、Inbox、标签、关系和来源；刷新/重启浏览器后逐项存在。
2. 模型断开时保存选区到 Inbox；确认只有原文/来源也合法，恢复模型后可重新分析。
3. 对同一 capture request 连续点击/重启后重试；确认返回同一 id，只生成一条 SourceCapture/Inbox/Card。
4. 在两个 Dashboard tab 同时编辑一张卡；后提交者看到 revision 冲突和 diff，不静默覆盖。
5. 修改模型解释并保留用户笔记；确认网页原文、原始 hash、用户字段均未改变。
6. 合并关系/标签、批量转正后执行撤销；核对逐项结果与 OperationLog。
7. 完成 Again/Hard/Good/Easy 各一次；确认 ReviewEvent append-only、ScheduleSnapshot due 更新，重启及事件重放后一致。
8. 暂停、归档、软删除卡片；确认历史/来源存在，删除标签不删除卡。
9. 构造旧版本库执行升级并在中途终止 worker；重开后确认回滚或继续到可验证终态，没有半迁移。
10. 完整备份导入新 profile；核对实体数量、抽样内容、关系、复习历史；确认明文凭证不在备份。
11. 从 content script console 尝试读取设置/数据库；确认拿不到凭证和领域真相，只能请求 SitePolicyView。
12. 使用规模数据执行性能脚本，保存报告；任一 p95 超预算必须有优化或经审批的预算调整。

## 15. 交付物与完成标准

- 领域实体 Zod schemas、provenance 与不变量测试；
- Dexie v1 schema、Repository、事务和查询实现；
- WXT SettingsGateway、trusted access 初始化、凭证隔离；
- 幂等/乐观并发/软删除/OperationLog；
- migration coordinator、`dexie-export-import` 备份 adapter、staging restore；
- 历史 migration fixture、round-trip、kill/restart 和规模 benchmark；
- 十二步人工验收记录。

完成标准：任何已确认写入在重启后存在；重复提交无重复；模型/页面内容不能覆盖来源与用户内容；升级失败可恢复；content script 无权读取凭证或直接写库。

## 16. 风险与待确认

| 风险/问题 | 当前决定 | 待确认/监测 |
|---|---|---|
| 新内容默认 Inbox 或正式库 | schema 同时支持，默认建议 Inbox | PRD §21 需真实使用决定 |
| URL canonicalization 误合并 | 保守保留 query，只去 fragment/已知 tracking | 页面来源真实样本 |
| 备份体积 | Blob 流式导出、保留策略可配置 | 提醒频率与数量待确认 |
| 大 migration 超 worker 生命周期 | 短事务/checkpoint；可见修复页承载长流程需 ADR | Chrome 30s/5min 边界实测 |
| Dexie nested index 兼容/效率 | 生产构建实测；必要时顶层投影 | schema v1 benchmark |
| 用户要求加密凭证/备份 | 当前依赖 Chrome profile 隔离且备份不含凭证 | 是否需要用户口令加密的独立方案 |
| 永久删除历史 | 默认软删和可恢复 | 保留窗口、隐私清除需求 |

## 17. 参考资料

- [Dexie API Reference](https://dexie.org/docs/API-Reference)
- [Dexie database versioning](https://dexie.org/docs/Tutorial/Design#database-versioning)
- [Dexie export/import](https://dexie.org/docs/ExportImport/dexie-export-import)
- [WXT storage](https://wxt.dev/storage)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN Web Crypto randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
