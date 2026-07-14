# 06 采集、查重与 Inbox 安全缓冲

## 文档状态

- 状态：拟定，可进入实现评审
- 范围：P0 保存前判断、创建/追加/跳过、Inbox；P1 批量整理与撤销
- 依赖：Dexie 4、MiniSearch、Zod 4、`@webext-core/messaging`
- 关联：05 AI 任务执行、07 知识库与搜索、08 FSRS 复习

## 1. 范围与非目标

### 1.1 范围

- 从明确的保存意图创建 `CaptureDraft`，保留原始选区与来源。
- 通过确定性规则、全文候选检索和可选 AI 建议生成查重决策预览。
- 把不确定或生成失败的内容安全放入 Inbox。
- 以确认等级约束自动执行；批量操作逐项报告并支持撤销。

### 1.2 非目标

- 不在用户仅形成选区时创建 capture、Inbox 或模型任务。
- 不追求自动完成所有语义合并；主题相关不等于重复。
- 不允许模型直接修改正式卡片。
- 不在本方案实现搜索 UI 或 FSRS 调度。

## 2. 需求映射

| PRD | 设计响应 |
|---|---|
| 3.1、6.1、7.1–7.2 | selection 与 capture 严格分离；只有保存/加入 Inbox 的明确命令才落库 |
| 7.6、9.1–9.4 | 生成失败仍保存原始材料；重复判断区分词形、义项、变体、相关和无关 |
| 9.5、15.4、19.4 | 批量前预览，逐项结果，最近一次批量操作可撤销 |
| 10.1–10.3、19.2 | 仅低风险动作可按偏好自动；合并正式卡等必须确认；禁止永久删除等自动操作 |
| 17.2 | 保存重试幂等，部分失败不伪装全成功 |

## 3. 关键决策与备选

### D1：分层判定，不采用单一相似度分数

判定流水线：规范化完全匹配 → 明确来源重复 → MiniSearch 候选召回 → 领域特征排序 → 可选 AI 给出带理由建议 → 风险策略。展示用户可理解的关系标签与理由，不暴露伪精确阈值。

- 未选“向量相似即合并”：相似不能区分同义、反义、不同义项和主题相关；且首版无必要引入 embedding 基础设施。
- 未选纯 LLM 查重：成本、延迟和不确定性不适合确定性重复。
- MiniSearch 只召回候选，不拥有合并决定。其官方仓库说明支持浏览器端字段搜索、前缀与模糊搜索：[MiniSearch](https://github.com/lucaong/minisearch)。

### D2：正式卡片操作以风险矩阵约束

| 操作 | 默认风险 | 自动条件 |
|---|---:|---|
| 相同来源的完全重复保存 | 低 | 用户开启自动跳过时 |
| 明确相同卡片追加新来源 | 低/中 | 用户开启且无候选冲突时 |
| 保存到 Inbox | 低 | 允许 |
| 新建正式卡 | 中 | 依用户“默认进 Inbox/正式库”设置；可要求全确认 |
| 增加义项、改核心解释/类型 | 高 | 永不自动，必须确认 |
| 合并两张正式卡、批量转正/标签/状态 | 高 | 必须预览并确认 |
| 删除正式卡、覆盖手写内容、清历史 | 禁止自动 | 只能走专门高风险流程 |

### D3：事件日志支持可理解撤销

每次写入形成 `MutationBatch` 和若干 `MutationRecord`，保存 before/after 或反向命令所需最小数据。撤销仍做权限和版本检查，不能静默覆盖撤销后发生的新编辑。

## 4. 组件边界

```text
Explicit Save Intent
  -> CaptureService (draft + provenance)
  -> DuplicateCandidateService (MiniSearch + Dexie exact lookup)
  -> DedupPolicy (domain rules)
  -> optional AI suggestion (TDD-05, advisory only)
  -> ActionPreview + RiskPolicy
  -> InboxService / CardMutationService
  -> MutationJournal + index outbox
```

- `CaptureService`：创建不可变原始证据与 idempotency key。
- `DuplicateCandidateService`：候选召回，不执行写入。
- `DedupPolicy`：LexiFlow 领域规则；这是允许自研的领域能力。
- `RiskPolicy`：唯一确认级别来源，UI 不自行降级风险。
- `InboxService`：条目状态和整理建议。
- `CardMutationService`：通过事务执行被批准的领域命令。
- `MutationJournal`：审计、逐项结果与撤销。

## 5. 领域与数据契约

```ts
type CaptureStatus = 'draft' | 'inbox' | 'committed' | 'skipped' | 'failed';
type RelationAssessment =
  | 'exact-duplicate' | 'same-form' | 'same-sense-new-context'
  | 'different-sense' | 'expression-variant' | 'near-synonym'
  | 'antonym-or-confusable' | 'topic-related' | 'unrelated' | 'uncertain';

interface CaptureDraft {
  id: string;
  idempotencyKey: string;
  selectedTextRaw: string;
  selectedTextNormalized: string;
  sourceSnapshotId: string;
  requestedAction: 'save' | 'save-to-inbox';
  createdAt: string;
  status: CaptureStatus;
}

interface DedupSuggestion {
  captureId: string;
  assessment: RelationAssessment;
  targetCardIds: string[];
  proposedAction: 'skip' | 'append-source' | 'new-card' | 'add-sense' | 'relate' | 'inbox';
  reasons: Array<{ code: string; message: string; evidenceRefs: string[] }>;
  certaintyBand: 'clear' | 'likely' | 'needs-confirmation' | 'insufficient-context';
  risk: 'low' | 'medium' | 'high';
}

interface InboxItem {
  id: string;
  captureId: string;
  rawEvidenceRef: string;
  generatedSuggestionRef?: string;
  state: 'pending' | 'paused' | 'processing' | 'resolved' | 'discarded';
  revision: number;
}
```

Dexie 表最低集合：`captures`、`sourceSnapshots`、`inboxItems`、`dedupSuggestions`、`mutationBatches`、`mutationRecords`、`outbox`。正式 `cards`、`cardSources`、`relations` 的所有跨表写入由 CardMutationService 单事务执行。Dexie 的 transaction 会把所列表内写入作为同一事务提交或失败：[Dexie transaction](https://dexie.org/docs/Dexie/Dexie.transaction%28%29)。

消息契约：

- `capture.commitIntent({ intentId, selectionSnapshotId, requestedAction, idempotencyKey })`
- `capture.previewDecision({ captureId })`
- `capture.applyDecision({ captureId, suggestionRevision, action, confirmationToken? })`
- `inbox.batchPreview({ itemIds, proposedAction })`
- `inbox.batchApply({ batchPreviewId, confirmationToken })`
- `inbox.undoBatch({ batchId, expectedRevision })`

Zod 校验所有命令；命令中不传任意 callback、SQL 或模型指令。

## 6. 查重算法

1. **规范化**：Unicode NFKC、trim、折叠空白；保留 raw。单词可生成 locale-safe lower-case lookup key，但不能据此合并专名。
2. **确定性查询**：同 normalized text + type/sense key；同 source + selection locator；相同 capture idempotency key。
3. **候选召回**：MiniSearch 查询正文、aliases、解释、标签；最多取 20 条。
4. **领域比较**：类型兼容、词形、已有来源、sense 标识、关系证据；排除反义/易混/仅主题相关。
5. **可选 AI 建议**：只对冲突候选解释关系；输入候选有上限；输出需 Zod 通过。
6. **风险策略**：候选冲突、上下文不足或高风险 action 一律 Inbox/确认。
7. **预览**：展示目标卡、理由、证据、影响字段和是否可撤销。

任何“certaintyBand”都不是统计概率；用户界面使用 PRD 规定的自然语言。

## 7. Inbox 状态机

```text
pending <-> paused
   | reanalyze
processing -> pending (new suggestion / failed, raw retained)
   | confirmed apply
resolved
   | explicit discard + confirmation
discarded
```

- revision 乐观锁防止旧建议覆盖新编辑。
- `processing` 不修改 raw evidence。
- `discarded` 为可撤销软状态；清理策略另行确认。

## 8. 正常、失败、取消与重启

### 正常路径

用户保存 → 建 capture → 查重预览 → 低风险按偏好执行或等待确认 → 单事务写 card/source/journal/outbox → 显示新建、追加、跳过或 Inbox。

### 失败路径

- AI 不可用：确定性查重仍运行；无法判断则保存 Inbox。
- 索引不可用：回退 Dexie exact lookup，提示候选检查不完整，不自动合并。
- 事务失败：所有领域写回滚，capture 标记可重试；绝不显示成功。
- 批量部分失败：每项独立事务/小批事务，返回逐项结果；不得以一个总成功覆盖失败项。

### 取消路径

查重或 AI 阶段取消后 capture 可留 draft 或进入 Inbox；取消后的 AI 结果不消费。已提交事务不能用“取消”伪回滚，必须走 undo。

### 重启路径

启动恢复 `processing` 超时条目为 `pending`，并标注 interrupted。扫描未投递 outbox 重建索引。已提交事务以 mutationId 去重，不重复追加来源。

## 9. 幂等、事务与并发

- `captures.idempotencyKey` 唯一：由 selection snapshot、requested action、用户 intent nonce 生成。
- `cardSources(cardId, sourceSnapshotId, selectedTextHash)` 唯一，重试不会重复来源。
- 每个 apply 命令带 `suggestionRevision`；版本不符返回冲突并刷新预览。
- 正式卡变更、journal 和 outbox 同一 Dexie 事务提交。
- 不把 LLM/network await 放进写事务；先获得建议，再开启短事务。
- 批量确认 token 绑定 item ids、预览 revision、action 和过期时间，防止 UI 变化后误执行。

## 10. 安全与隐私

- 永久保留 raw 与 normalized 的来源区分；模型生成不能替换 raw。
- Inbox 丢弃、合并正式卡、批量转正等必须确认；RiskPolicy 服务端边界再次校验，不能只依赖按钮。
- 搜索/模型输入仅包含完成判断所需候选；凭证不进入 Capture 数据。
- 来源 URL 可含敏感 query；展示/导出策略由数据 TDD 统一处理，模型默认只发送经清理的 URL 元数据。
- 操作日志不记录完整模型 prompt 或凭证。

## 11. 性能预算

- 保存 intent 本地接收：P95 ≤ 100ms。
- 10,000 卡下确定性查重 + MiniSearch 召回：P95 ≤ 150ms（中档设备，索引热）。
- 事务提交：单项 P95 ≤ 100ms；批量每批不超过 100 项并持续反馈。
- 查重候选上限 20，发送 AI 的上下文和候选有严格预算。
- Inbox 列表使用分页/虚拟化，单次查询默认 ≤ 100 项。

## 12. 自动化测试

- 单元：规范化、关系分类、风险矩阵、确认门禁、undo 冲突。
- 属性测试：规范化幂等；任意高风险 action 无 confirmation 均拒绝；topic-related 永不自动 merge。
- 集成：Dexie 原子性、唯一键、revision 冲突、outbox 重放、索引失效降级。
- AI 契约：无效/冲突建议进入 Inbox，不可直接 mutate。
- E2E：选区不落库；重复保存；新增上下文；不同义项；批量部分失败；浏览器重启恢复；正式卡合并必须确认。

## 13. 逐步人工验收

1. 选中文本但不点击：检查 Capture/Inbox 数量均不变化，网络无 LLM 请求。
2. 保存全新内容：看到新建或 Inbox 的明确结果，来源可回看。
3. 对相同来源重复保存两次：不新增 card/source；结果为跳过重复。
4. 从不同页面保存相同用法：建议追加来源；执行后只有一张卡、两个来源。
5. 保存同词不同义项和近义/反义表达：不得统一判为重复或静默合并。
6. 关闭模型后保存：原文和来源完整进入 Inbox。
7. 尝试合并正式卡：必须看到目标、理由、影响和确认；取消后零变化。
8. 对低风险同类项批量确认：先看摘要，完成后看逐项结果；撤销后恢复。
9. 批量中制造一项版本冲突：其他结果与失败项分别展示。
10. 写入中重启浏览器：已提交内容不重复，未完成条目回 pending。

## 14. 交付物与完成标准

- Capture、Dedup、Risk、Inbox、MutationJournal 服务与 Zod 契约。
- Dexie schema、迁移、唯一索引、事务和 outbox。
- MiniSearch 候选 adapter；索引不可用降级。
- 单项/批量预览、确认、逐项结果与撤销。
- 完成标准：自动化全过；人工验收 1–10 有证据；正式卡高风险操作无法绕过确认；选区本身零落库、零 LLM。

## 15. 风险与待确认

- 语言规范化过度会导致误合并：规范化只用于候选键，最终保留 raw 和类型/语境判断。
- 撤销日志增大存储：保留期限和最近批次数待确认，不能未说明即清理。
- 待确认：新内容默认进入 Inbox 还是低风险直入正式库；哪些追加来源可自动。
- 待确认：批量大小、置信表达文案、discard 保留期。

## 16. 官方参考

- [Dexie 4](https://dexie.org/)
- [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction%28%29)
- [MiniSearch](https://github.com/lucaong/minisearch)
- [Zod](https://zod.dev/)
- [webext-core messaging](https://webext-core.aklinker1.io/messaging/installation)
