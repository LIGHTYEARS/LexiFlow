# 08 FSRS 复习、历史重放与错误追踪

## 文档状态

- 状态：拟定，可进入实现评审
- 范围：P0 今日复习、FSRS 6、四档反馈、复习/错误历史；P1 专项练习与错误聚合
- 依赖：`ts-fsrs`（FSRS 6）、Dexie 4、Zod 4、`@webext-core/messaging`
- 关联：07 知识库、05 AI 任务执行、数据备份方案

## 1. 范围与非目标

### 1.1 范围

- 生成逾期、到期、学习/重学、新卡的今日队列。
- 使用 ts-fsrs/FSRS 6 预览与提交 Again/Hard/Good/Easy。
- 以 append-only 复习事件为真相，派生当前排程；历史可重放。
- 记录用户答案、用时、个人错误类型和系统建议。
- 专项练习默认独立于 FSRS，只有显式开启并确认才可产生调度事件。

### 1.2 非目标

- 不自行实现或修改 FSRS 公式。
- 不在 P0 自动训练个性化 FSRS 参数。
- 不把模型对答案质量的判断自动等同于四档记忆反馈。
- 不把候选开放式表达反馈写入 FSRS。
- 不提供排行榜或惩罚性连续打卡。

## 2. 需求映射

| PRD | 设计响应 |
|---|---|
| 12.1、19.5 | 今日队列优先逾期/到期/学习与重学，再按上限加入新卡；提交后展示下次到期 |
| 12.2–12.3 | 四档反馈和多种复习方式，评分表示记忆难度而非语言质量 |
| 12.4 | append-only 事件记录卡片、时间、rating，并可关联答案、耗时、错误类型和笔记 |
| 12.5–12.6、19.6 | 专项练习默认不影响 FSRS；影响前显式开启并在提交前说明 |
| 8.4、10.3、15.2 | 暂停/归档不清历史；禁止自动清空或重置学习进度；备份包含完整历史 |
| 17.2 | 提交幂等；重启后历史与排程一致 |

## 3. 关键决策与备选

### D1：ts-fsrs 是唯一调度算法实现

通过 ts-fsrs 的 `repeat`/`next`（以锁定版本实际 API 为准）预览和提交，不复刻 FSRS 数学。ts-fsrs 官方仓库说明其为 TypeScript FSRS 工具包，并返回下一张卡状态及 review log：[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)。项目锁定支持 FSRS 6 的已验证版本和参数快照，升级必须回放兼容测试与 ADR。

### D2：事件是事实，schedule snapshot 是缓存

`ReviewEvent` append-only；`ScheduleSnapshot` 是用卡片初始状态、参数版本和事件序列重放得到的投影。每次提交在同一 Dexie 事务追加 event、更新 snapshot、写 projection metadata。这样可审计、恢复、迁移并检测漂移。

### D3：一次作答一次显式 rating

用户先自测/输入，再显示答案，最终点击四档。系统可推荐但不得代替用户 rating。重复点击通过 session/attempt id 幂等。

### D4：错误建议与用户判断分栏

系统建议 `suggestedErrorTypes`，用户确认/修改后保存 `confirmedErrorTypes`；前者永不覆盖后者。Again/Hard 可进入错误页，但不自动推断具体错误类型。

## 4. 组件边界

```text
Review UI
 -> ReviewQueueService (due policy + limits)
 -> ReviewSessionService (prompt/reveal/rating state)
 -> FsrsSchedulerAdapter (ts-fsrs only)
 -> ReviewLedger (append event + snapshot transaction)
 -> ErrorTrackingService
 -> PracticeService (separate history; optional confirmed bridge)
```

- `FsrsSchedulerAdapter`：ts-fsrs 类型适配、版本固定、日期归一；不改公式。
- `ReviewLedger`：事件序号、幂等、重放和 snapshot 校验。
- `ReviewQueueService`：产品优先级与每日上限，非 FSRS 数学。
- `ReviewSessionService`：展示前后状态，防止未 reveal/未确认提交。
- `ErrorTrackingService`：错误建议、用户确认、聚合。
- `PracticeFsrsBridge`：默认禁用；唯一可将专项练习转为 review intent 的边界。

## 5. 领域与数据契约

```ts
type ReviewRating = 'again' | 'hard' | 'good' | 'easy';
type ReviewMode = 'quick' | 'input' | 'cloze' | 'imitation' | 'distinguish';

interface ReviewEvent {
  eventId: string;
  cardId: string;
  sequence: number;             // per card monotonic
  sessionId: string;
  attemptId: string;
  occurredAt: string;           // UTC instant
  rating: ReviewRating;
  mode: ReviewMode;
  schedulerVersion: string;
  parameterSetId: string;
  previousStateHash: string;
  resultingState: FsrsStateDto;
  schedulerLog: FsrsLogDto;
  source: 'review' | 'practice-confirmed';
}

interface ScheduleSnapshot {
  cardId: string;
  lastSequence: number;
  state: FsrsStateDto;
  dueAt: string;
  stateHash: string;
  schedulerVersion: string;
  parameterSetId: string;
}

interface ReviewAttemptDetail {
  attemptId: string;
  cardId: string;
  sessionId: string;
  answer?: string;
  referenceAnswerRef?: string;
  durationMs?: number;
  personalNote?: string;
  suggestedErrorTypes: ErrorType[];
  confirmedErrorTypes: ErrorType[];
}
```

`FsrsStateDto` 显式存储 ts-fsrs 所需字段（due、stability、difficulty、elapsedDays、scheduledDays、reps、lapses、state、lastReview 等），禁止直接序列化库的 class instance。字段命名/日期转换由 adapter 集中处理。

Dexie 表：`reviewEvents`、`scheduleSnapshots`、`reviewAttemptDetails`、`reviewSessions`、`errorAnnotations`、`practiceSessions`、`practiceItems`、`practiceAttempts`、`fsrsParameterSets`、`reviewProjectionMeta`。唯一键：`eventId`、`attemptId`、`[cardId+sequence]`。

消息契约：

- `review.createSession({ dateBoundary, limits, modes })`
- `review.next({ sessionId })`
- `review.reveal({ sessionId, cardId, attemptId })`
- `review.previewRating({ attemptId, rating })`
- `review.commitRating({ attemptId, rating, expectedSequence })`
- `review.annotateError({ eventId, confirmedTypes, note })`
- `review.rebuildSchedule({ cardIds?, dryRun: true })`
- `practice.previewFsrsImpact({ practiceAttemptIds })`
- `practice.commitFsrsImpact({ previewId, confirmationToken })`

## 6. 今日队列算法

1. 以用户时区和明确的本地日边界生成 session snapshot；存下 timezone 与 boundary instant，避免午夜漂移。
2. 排除 deleted、archived、paused 卡；不删除其历史。
3. 依次选择：逾期（dueAt < 今日起点）、今日到期、学习/重学、在新卡上限内的新卡。
4. 各组内默认 dueAt 升序；“困难优先”仅作为可配置次排序，不改 FSRS due。
5. 应用每日总复习与新卡上限；已完成 attempt 不重复入队。
6. session 队列是可恢复快照；卡状态版本变化时重新验证当前项。

队列优先级是 LexiFlow 产品策略；间隔计算完全交给 ts-fsrs。

## 7. 评分状态机

```text
prompting -> answered? -> revealed -> rating-preview -> committed -> next
     |                         |             |
     +------skip/pause---------+             +-> conflict/reload
```

1. `prompting` 阶段不展示答案。
2. 用户输入可选；必须 reveal 后才能提交 rating（辅助功能可配置明确例外）。
3. preview 通过 ts-fsrs 展示四档对应的下一到期日期，不落库。
4. commit 读取最新 snapshot，验证 `expectedSequence` 和 `previousStateHash`。
5. adapter 调用 ts-fsrs，形成 event + resulting snapshot。
6. Dexie 单事务追加 event、details、snapshot、session progress。
7. 提交完成后显示下一安排；若事务失败保留当前题和用户输入。

## 8. 历史重放

### 8.1 基本规则

- 按 `(cardId, sequence)` 严格排序，从版本化初始状态开始。
- 每个 event 记录 schedulerVersion、parameterSetId、occurredAt、rating 和 resulting hash。
- 重放使用对应版本 adapter/兼容策略；结果逐事件与保存 hash 对比。
- dry-run 报告缺失、顺序冲突和漂移，不修改生产 snapshot。
- 校验通过后才在单事务切换重建 snapshot，并记录 rebuild report。

### 8.2 参数/SDK 升级

升级不静默重算历史。先对固定 golden fixtures 和全库 dry-run 比较：历史事实保持不变；是否按新算法重新计算未来 schedule 是用户可理解的迁移决定，并需 ADR、备份和回滚。

## 9. 正常、失败、取消与重启

### 正常路径

创建 session → 展示卡 → 自测/输入 → reveal → 四档 preview → 用户提交 → 原子写 event/snapshot → 显示 next due → 下一张。

### 失败路径

- ts-fsrs adapter 抛错或产生非法日期：不写 event，显示可重试；记录脱敏诊断。
- 事务失败：event/snapshot/session 全回滚，按钮恢复，保留输入。
- revision/sequence 冲突：刷新 snapshot，提示该卡已在其他页面复习，不自动重复提交。
- 错误建议 AI 失败：评分照常提交，错误类型可手动补充。

### 取消路径

取消未提交 attempt 不产生 ReviewEvent，可保留 session 草稿；已提交评分不可通过取消删除，只能由受控“更正记录”流程追加 correction event/审计，不改写原历史。

### 重启路径

session、attempt 草稿和 committed progress 持久化。启动以 ReviewLedger 检查 snapshot；内存状态不是真相。未提交 attempt 可恢复或丢弃，已提交 attempt 通过唯一 id 不重复。

## 10. 幂等、事务与并发

- `attemptId` 唯一；重复 commit 返回原 event 与 due。
- 每卡 `expectedSequence` 乐观锁；同卡跨 tab 同时评分只有一个成功。
- ReviewEvent、AttemptDetail、Snapshot、SessionProgress 同一 Dexie 事务。
- 事件 append-only；用户修改错误标签只更新 annotation revision，不改 scheduler event。
- 专项练习 bridge 的 confirmation token 绑定 attempts、映射 rating、影响摘要和过期时间。

## 11. 专项练习与错误追踪

- `PracticeSession/PracticeItem/PracticeAttempt` 独立保存题型、来源卡、答案、结果和解释。
- 默认 `affectsFsrs=false`，不会写 ReviewEvent。
- 用户开启某类影响规则后，每次提交前预览哪些卡、如何映射四档、预期 due 变化；确认后才由 bridge 产生 `source='practice-confirmed'` 的事件。
- 系统错误建议与用户确认分开；聚合只以 confirmed 为主要口径，Again/Hard 作为独立事实维度。
- 错误页按近期、高频、confusable 关系、类型、标签筛选，并可回到卡片与原始上下文。

## 12. 安全与隐私

- 答案、笔记和错误历史默认本地；若请求 AI 建议，必须走 05 的最小输入与 trusted extension context。
- content script 不能查询复习历史；Dashboard/Popup 经 sender 校验和类型化消息访问摘要。
- 删除/归档卡片不清历史；清空或重置进度是禁止自动动作，必须专门确认和备份。
- 日志不记录答案全文、凭证或 LiteLLM baseURL。

## 13. 性能预算

- 今日队列初建：10,000 卡 P95 ≤ 300ms；可用 indexed dueAt 查询，不全表排序。
- 下一题读取 P95 ≤ 50ms；rating preview P95 ≤ 20ms；commit P95 ≤ 100ms。
- 单卡全历史重放 10,000 events ≤ 500ms；全库重放分批、显示进度且不阻塞复习 UI。
- 默认 session 仅物化当日上限，不加载全部 due cards。
- 错误聚合使用增量投影或 IndexedDB 索引，页面查询 P95 ≤ 200ms。

## 14. 自动化测试

- adapter golden tests：四个 rating、所有 FSRS 状态、闰日/时区/DST、非法输入；固定 ts-fsrs 版本。
- queue：优先级、上限、paused/archived、午夜边界、困难次排序。
- ledger：重复提交、跨 tab 冲突、事务回滚、重启恢复、append-only 不变式。
- replay：从空状态重放与 snapshot hash 一致；篡改/缺序/版本不兼容可检测；重建可回滚。
- practice：默认零 ReviewEvent；无 confirmation 无法 bridge；影响预览与实际一致。
- E2E：完整今日复习、Again/Hard 错误页、浏览器重启、历史查看。

## 15. 逐步人工验收

1. 准备逾期、今日到期、学习中和新卡，创建今日 session：顺序和每日上限正确。
2. 完成一张卡的自测、reveal 和四档 preview：四档含义明确且日期不同。
3. 选择 Good 并提交：立即看到新 due，历史新增一条，刷新/重启仍存在。
4. 双击评分按钮或两个 Dashboard 同时提交：只产生一个事件，另一处得到冲突/原结果。
5. 模拟 Dexie 写失败：不新增 history，不改变 due，输入仍可恢复。
6. 对 Again/Hard 添加并修改错误类型：系统建议不覆盖用户选择；错误页可找到。
7. 完成专项练习：默认只进 practice history，FSRS event 和 due 不变。
8. 开启专项练习影响规则：提交前看到影响，取消零变化，确认后事件标记来源。
9. 暂停、归档卡片：不进入队列但历史仍可看；删除/重置要求确认。
10. 删除 schedule snapshot 后执行 dry-run/rebuild：由事件恢复相同状态；制造事件缺口时明确失败，不静默猜测。
11. 升级模拟 adapter 运行 golden/replay：未通过时禁止迁移。

## 16. 交付物与完成标准

- ts-fsrs adapter、参数版本模型、队列/session 服务。
- append-only ReviewLedger、snapshot、重放/校验/重建工具。
- 错误注释、错误聚合、PracticeSession/Item/Attempt 与默认关闭 bridge。
- 单元、golden、事务、重放和 E2E 测试。
- 完成标准：人工验收 1–11 有记录；历史可从备份事件独立重建；重复/并发评分不产生双事件；专项练习默认不改变 FSRS；无自研 FSRS 算法。

## 17. 风险与待确认

- ts-fsrs API/FSRS 版本演进：锁版本并通过 adapter、fixtures 和升级 ADR 隔离。
- 用户更改时区或系统时钟：事件保存 UTC 与 session timezone；跨时区日界规则待确认。
- 历史长期增长：append-only 是恢复基础，不得为节省空间静默删除；归档/压缩需数据 ADR。
- 待确认：每日上限、默认复习方式、困难优先策略、参数高级设置、何种专项练习可影响 FSRS。
- 待确认：是否需要更正误评分；若实现必须追加审计事件，不能删除原事件。

## 18. 官方参考

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- [Open Spaced Repetition implementations](https://github.com/open-spaced-repetition/awesome-fsrs)
- [Dexie transaction](https://dexie.org/docs/Dexie/Dexie.transaction%28%29)
- [Zod](https://zod.dev/)
- [webext-core messaging](https://webext-core.aklinker1.io/messaging/installation)
