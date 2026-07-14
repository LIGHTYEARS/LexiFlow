# 07 知识库、来源与本地搜索

## 文档状态

- 状态：拟定，可进入实现评审
- 范围：P0 卡片/来源浏览、编辑、搜索、筛选、状态管理；P1 标签、关系、来源聚合与高级筛选
- 依赖：Dexie 4、MiniSearch、Zod 4、`@webext-core/messaging`
- 关联：06 采集与 Inbox、08 FSRS 复习、数据备份方案

## 1. 范围与非目标

### 1.1 范围

- 四类卡片的共享字段与类型化内容模型。
- 来源、内容 provenance、标签、关系、编辑修订和卡片生命周期。
- Dexie 作为唯一真相源，MiniSearch 作为可丢弃、可重建的派生索引。
- Dashboard 中搜索、筛选、详情与来源聚合的查询契约。

### 1.2 非目标

- 不实现云同步或多人冲突解决。
- 不由搜索结果自动合并、删除或改变卡片。
- 不把搜索索引纳入完整备份的必要恢复数据。
- 不在 content script 暴露主数据库；页面侧只能通过受限类型化命令请求所需摘要。

## 2. 需求映射

| PRD | 设计响应 |
|---|---|
| 8.1–8.4、19.3 | 四类卡片类型化字段、多个来源、关系、用户编辑优先、暂停/归档/删除 |
| 11.1–11.4 | 跨正文/解释/例句/标签/来源/笔记搜索；多维筛选；来源和标签聚合 |
| 15.1–15.3、17.2 | 本地 Dexie 持久化，版本迁移；完整备份恢复后索引可重建 |
| 10.2–10.3 | 改核心解释/类型、批量状态、归档/删除必须确认；不得覆盖手写内容 |
| 14.5 | 用户可查看占用并主动重建搜索能力 |

## 3. 关键决策与备选

### D1：Dexie 4 是真相源，MiniSearch 是派生投影

所有卡片、来源、关系和修订先原子提交 Dexie，再通过同事务 outbox 增量更新 MiniSearch。索引损坏、版本不匹配或丢失时从 Dexie 全量重建。Dexie 简化浏览器 IndexedDB 并提供事务与响应式查询：[Dexie](https://dexie.org/)、[liveQuery](https://dexie.org/docs/liveQuery%28%29)。MiniSearch 提供浏览器内全文、前缀和模糊检索：[MiniSearch](https://github.com/lucaong/minisearch)。

- 未选直接扫描 IndexedDB：数据增长后无法满足持续搜索体验。
- 未选远程搜索或向量库：违反本地默认且首版收益不足。
- 未选自研倒排索引：成熟依赖已覆盖能力。

### D2：共享壳 + 类型化内容，而非巨型可空表

`cards` 保存生命周期、检索和复习共用字段；`cardContents` 保存带 schemaVersion 的 discriminated union。类型变更是高风险迁移：先预览字段保留/丢失，再确认，旧修订可回看。

### D3：provenance 细化到内容块

网页原文、用户编辑和模型生成不能只用卡片级标记。每个解释、例句、笔记、来源摘录带 `origin`；用户编辑后的块为 `user-edited` 并保留 `derivedFrom`。

### D4：删除默认软删除

删除正式卡需要确认并写 tombstone；硬清理属于数据维护策略，不是普通卡片操作。标签删除只移除关联，不删除卡片。

## 4. 组件边界

```text
Dashboard UI
  -> KnowledgeQueryService -> Dexie truth + SearchIndexReader
  -> CardCommandService -> authorization/risk -> transaction + revision + outbox
  -> SearchProjectionWorker -> MiniSearch snapshot

Content script
  -> typed restricted query (duplicate/page summary only)
  X no DB handle, credential, baseURL, bulk card export
```

- `CardRepository`：唯一持久化 adapter。
- `CardCommandService`：验证 expectedRevision、风险确认、用户内容保护。
- `KnowledgeQueryService`：分页、筛选、详情与聚合。
- `SearchProjectionWorker`：消费 outbox、构建/切换索引。
- `ProvenancePolicy`：控制字段替换与生成内容标签。

## 5. 领域模型

```ts
type CardType = 'word' | 'phrase' | 'sentence' | 'technical-term';
type CardLifecycle = 'active' | 'paused' | 'archived' | 'deleted';
type ContentOrigin = 'web-source' | 'user-authored' | 'model-generated' | 'user-edited';

interface Card {
  id: string;
  type: CardType;
  canonicalText: string;
  lifecycle: CardLifecycle;
  contentId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface ContentBlock<T> {
  id: string;
  value: T;
  origin: ContentOrigin;
  sourceRef?: string;
  aiTaskRef?: string;
  derivedFrom?: string;
  updatedAt: string;
}

type CardContent =
  | { type: 'word'; lemma?: ContentBlock<string>; senses: ContentBlock<Sense>[]; forms: string[] }
  | { type: 'phrase'; meanings: ContentBlock<string>[]; patterns: ContentBlock<string>[]; register?: ContentBlock<string> }
  | { type: 'sentence'; translation?: ContentBlock<string>; reusablePatterns: ContentBlock<string>[] }
  | { type: 'technical-term'; domain?: ContentBlock<string>; definitions: ContentBlock<string>[]; relatedConcepts: string[] };
```

辅助实体：

- `SourcePage(id, canonicalUrl, displayUrl, domain, title, firstCapturedAt, lastCapturedAt)`
- `SourceExcerpt(id, pageId, cardId, rawText, adjacentText, selector?, capturedAt)`
- `Tag(id, normalizedName, displayName, revision)` 与 `CardTag(cardId, tagId)`
- `CardRelation(id, fromCardId, toCardId, kind, direction, origin, revision)`
- `CardRevision(id, cardId, revision, patch, actor, createdAt)`
- `SearchOutbox(sequence, entityType, entityId, operation, committedAt)`

关系类型仅允许 PRD 可理解集合：variant、synonym、antonym、confusable、word-family、pattern-use、related。`related` 永远不意味着 merge。

## 6. 数据与消息契约

Dexie 建议索引：

```text
cards:          id, type, lifecycle, updatedAt, createdAt, [lifecycle+updatedAt]
cardContents:   cardId, schemaVersion
sourcePages:    id, canonicalUrl, domain, lastCapturedAt
sourceExcerpts: id, cardId, pageId, capturedAt, [pageId+capturedAt]
tags:           id, &normalizedName
cardTags:       &[cardId+tagId], cardId, tagId
relations:      id, fromCardId, toCardId, kind
revisions:      id, [cardId+revision], createdAt
searchOutbox:   ++sequence, entityId, operation
meta:           key
```

受信任 UI 消息：

- `knowledge.search({ query, filters, cursor, limit })`
- `knowledge.getCard({ cardId })`
- `knowledge.previewPatch({ cardId, expectedRevision, patch })`
- `knowledge.applyPatch({ previewId, confirmationToken? })`
- `knowledge.listBySource({ pageId, cursor })`
- `knowledge.rebuildSearch({ reason })`

content script 只允许 `knowledge.getPageSummary({ canonicalPageKey })` 和查重所需受限候选摘要，不允许任意 search/export/getCard。所有响应经过 Zod 且裁剪字段。

## 7. 搜索索引设计

### 7.1 文档投影

每张非删除卡映射为一个 MiniSearch document：

- fields：canonicalText、definitions、examples、tags、sourceTitle、sourceDomain、notes、aliases；
- storeFields：仅 cardId、type、lifecycle、updatedAt 和少量摘要；
- Boost：canonicalText > aliases/tags > definitions > examples/source/notes；具体权重需以真实数据调优。

### 7.2 查询

1. Zod 校验 query/filter/cursor；限制 query 长度。
2. 空 query 直接走 Dexie 筛选排序。
3. 非空 query 走 MiniSearch，得到有序 cardIds。
4. Dexie 批量读取当前卡片，重新应用 lifecycle/日期/标签/来源/复习筛选，移除陈旧命中。
5. 稳定排序并返回 cursor；不把内部 relevance 当作语言正确性或学习价值分数。

### 7.3 增量与重建

- 写事务同步写 outbox，事务后异步消费。
- 索引元数据保存 `indexSchemaVersion`、`lastAppliedSequence`、`builtAt`、`documentCount`。
- 检测序列缺口、schema 变化、解析失败或用户点击重建时，全量 rebuild 到临时索引；成功校验数量与抽样后原子切换。
- 重建期间仍可用旧索引；无旧索引则提供 Dexie 精确/前缀降级并明确提示。

## 8. 卡片状态与编辑状态机

```text
active <-> paused
active/paused -> archived -> active
active/paused/archived --confirmed delete--> deleted
deleted --undo within policy--> prior lifecycle
```

- lifecycle 不删除复习和错误历史。
- 类型/核心解释变更必须生成 preview；用户块默认不可被模型 patch 替换。
- revision 乐观锁：旧详情提交返回冲突与差异，不做 last-write-wins。

## 9. 正常、失败、取消与重启

### 正常路径

编辑 → preview diff → 必要确认 → Dexie 事务写 card/content/revision/outbox → UI 从 truth 读取 → 索引异步追平。

### 失败路径

- Dexie 写失败：全事务回滚，UI 保留草稿，不显示成功。
- 索引写失败：领域提交仍成功，标记 index degraded 并重试；搜索可降级。
- 查询命中陈旧 id：Dexie 二次过滤，不展示删除/不符合条件的数据。
- migration 失败：停止打开写模式，提示从升级前备份恢复；不创建半迁移库。

### 取消路径

取消未提交编辑只丢弃 UI draft；事务提交后必须以显式逆向命令撤销。搜索请求使用 requestId，晚到结果因 generation 不匹配被忽略。

### 重启路径

Dexie 保存的数据为真相。启动检查 migration、outbox sequence 和 index schema；继续消费或重建。任何内存 cache/worker 状态都不作为已保存依据。

## 10. 幂等与事务

- apply patch 使用 `commandId` 唯一记录；重复命令返回原结果。
- card/content/revision/outbox 同一 Dexie 事务。
- 标签重命名/合并以 normalizedName 唯一约束并预览影响。
- 关系使用规范化端点唯一键，避免重复；有向/无向关系由 kind 明确定义。
- 索引消费以 sequence 幂等；重放同 sequence 不改变结果。

## 11. 安全与隐私

- 主数据库只在 extension trusted contexts 打开；content script 与宿主页面不能拿 DB handle。
- 消息白名单、sender 校验、Zod 校验、最大 limit；避免页面通过扩展枚举全部知识库。
- 搜索索引与数据库都只保存在本地；不加载远程字体、分析或搜索服务。
- URL 展示需隐藏凭证型 query/fragment；完整备份是否保留原 URL 由数据方案定义并在导出前说明。
- model-generated 块始终可见标记；用户块覆盖保护在 command service 强制执行。

## 12. 性能预算

- 目标规模：10,000 cards、50,000 excerpts、100,000 revisions 下可用。
- 热索引普通搜索 P95 ≤ 150ms；筛选/分页 P95 ≤ 200ms；卡片详情 P95 ≤ 100ms。
- 首屏每页 ≤ 50，后续 cursor；禁止一次把全库发送 UI。
- 10,000 卡全量索引重建目标 ≤ 10s，分片并至少每 50ms 让出主线程；UI 显示进度并可取消后重来。
- 索引存储预算由实现测量，超过源文本 2 倍需评审字段与 storeFields。

## 13. 自动化测试

- schema：四类 content union、迁移、索引、唯一键、provenance。
- 命令：用户内容保护、高风险确认、revision 冲突、软删除/恢复。
- 搜索：中文/英文、大小写、短语、模糊/前缀、组合筛选、稳定分页、陈旧结果过滤。
- 重建：索引为空/损坏/版本升级/中断/outbox 缺口，重建后结果与源库基准一致。
- 权限：content script 任意 getCard/export/search 请求被拒，响应无 baseURL/凭证/完整主库。
- E2E：创建、编辑、来源导航、标签、归档、删除确认、重启后继续搜索。

## 14. 逐步人工验收

1. 分别创建单词、短语、佳句、技术术语，确认字段适合类型且共同信息完整。
2. 检查网页原文、模型解释和用户笔记的来源标识；请求重新解释不得覆盖用户笔记。
3. 用正文、解释、例句、标签、来源标题和笔记分别搜索，命中正确卡片。
4. 组合类型、标签、站点、日期、状态和到期筛选；翻页无重复/遗漏。
5. 从来源页查看卡片和 Inbox 数；卡片详情可回到原始摘录。
6. 尝试改类型、归档、删除：看到影响和确认；取消后不变。
7. 删除标签：卡片仍存在；合并标签前显示影响。
8. 删除本地 MiniSearch snapshot 后重启：卡片仍在，重建完成后搜索恢复。
9. 在重建中关闭浏览器再打开：不会把空/半索引当完成，可重新构建。
10. 在页面控制台尝试读取主库或发送越权消息：被拒绝且不返回敏感字段。

## 15. 交付物与完成标准

- Dexie schema/迁移、四类卡片模型、provenance、修订和 lifecycle。
- Card command/query service 与受限消息协议。
- MiniSearch projection、outbox、健康检查、重建与降级。
- 搜索/筛选/来源/标签/详情功能及测试。
- 完成标准：人工验收 1–10 有证据；索引可从仅含源数据的恢复库重建；用户内容不可被模型静默覆盖；content script 无主库访问能力。

## 16. 风险与待确认

- MiniSearch 内存随库增长：以真实样本测量；必要时缩减字段/分区，而非自研索引。
- URL canonicalization 可能误合并页面：保留 display/raw 证据，规则需样本验证。
- 待确认：编辑历史保留期、软删除回收期、默认搜索权重、关系/标签实际维护价值。
- 待确认：统计需要的聚合字段；不得为未确认统计提前复制真相数据。

## 17. 官方参考

- [Dexie](https://dexie.org/)
- [Dexie liveQuery](https://dexie.org/docs/liveQuery%28%29)
- [Dexie transaction](https://dexie.org/docs/Dexie/Dexie.transaction%28%29)
- [MiniSearch](https://github.com/lucaong/minisearch)
- [Zod](https://zod.dev/)
