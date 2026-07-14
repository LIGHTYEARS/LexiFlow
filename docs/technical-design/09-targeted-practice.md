# 09 专项练习技术方案

## 文档状态

- 状态：拟实施
- 对应范围：PRD 6.4、10.2、12.3–12.6、14.4、19.6
- 交付优先级：P1；P0 的 FSRS 复习不依赖本文完成
- 核心约束：专项练习默认只写练习历史，**不修改 FSRS**；允许影响 FSRS 的能力必须另行启用，并在每次提交前展示具体影响

## 1. 范围与非目标

本文设计从错误记录、困难卡片、标签或手选卡片生成一组专项练习，支持中译英、英译中、完形填空、选择题、近义表达区分、仿写、技术术语解释和错题回放，并把结果关联回原卡片与来源。

非目标：不实现正式考试评分；不把开放答案反馈包装为真人教师判断；不自动创建卡片、关系或错误类型；不复刻 FSRS 算法；不在首版中让任意练习结果静默改变调度。

## 2. 需求映射

| 产品要求 | 技术落点 | 验证证据 |
|---|---|---|
| 可从多种来源发起 | `PracticeSourceQuery` 只读取稳定 ID | 用每种来源各创建一组 |
| 说明重点和来源 | 练习集快照保存 `focus`、`sourceRefs` | 逐题打开来源卡片 |
| 参考答案与解释 | 题目保存结构化参考信息及 provenance | UI 可区分网页、用户和模型内容 |
| 记录结果 | 一题一条 attempt，组级 session 汇总 | 重启后历史仍可见 |
| 默认不影响 FSRS | 练习写路径与复习写路径物理分离 | 前后比较卡片 FSRS 字段 |
| 开放答案边界 | 仅自评/参考对照；AI 反馈是可选建议 | 不出现权威分数或“母语者认证” |

## 3. 关键决策与备选

1. **快照题目，而不是运行时回读卡片。** 创建练习时固化题干、答案和来源引用，保证练习中卡片被编辑也不改变已开始会话；卡片详情仍读取最新实体。备选“只存 cardId”无法复盘历史，否决。
2. **生成与作答解耦。** 规则题优先由确定性模板生成；需要模型的题型通过统一 LLM SDK adapter 请求结构化结果。不得直接 `fetch` LiteLLM 或手写 SSE parser。备选“所有题都由模型生成”延迟高且失败面大，否决。
3. **默认自评。** 选择题可确定性判定，开放题展示参考答案后由用户记录结果；候选的深度写作反馈不进入本方案。
4. **专项练习写路径不调用 FSRS 仓储。** 用户日后显式启用影响排程时，也必须走复习域公开命令并记录 `scheduleMutationConsentId`，禁止直接改卡片调度字段。
5. **SDK-first。** 题型状态用现有应用状态方案；表单/可访问交互复用 React Aria Components；模型调用复用项目统一 AI SDK。若成熟依赖不适用，先提交 ADR，写明调研、拒绝理由、最小自研范围与替换条件。

## 4. 组件边界

- `PracticeSourceResolver`：把错误、卡片、标签查询解析为稳定 ID，禁止写库。
- `PracticeBlueprintFactory`：选择题型与确定性模板；不访问 UI。
- `PracticeGenerationService`：只为需要生成的题调用 LLM adapter；Zod 校验后返回草稿。
- `PracticeSessionRepository`：原子保存 session、item、attempt。
- `PracticeRunner`：状态 `preparing → answering → revealed → completed|cancelled`。
- `ScheduleImpactGateway`：默认禁用；唯一可将明确同意的结果交给复习域的边界。
- UI：Dashboard 专项练习入口、运行页、结果页；使用 React Aria 的表单、选择和 Dialog 能力。

练习域不得导入 FSRS 数据表实现，也不得把模型响应直接写入正式卡片。

## 5. 数据与协议契约

```ts
type PracticeSession = {
  id: string;
  status: 'preparing' | 'active' | 'completed' | 'cancelled' | 'failed';
  focus: string;
  source: { kind: 'errors'|'cards'|'tag'|'manual'; ids: string[] };
  createdAt: string;
  completedAt?: string;
  schedulePolicy: 'history-only' | 'explicit-review-command';
};

type PracticeItem = {
  id: string;
  sessionId: string;
  type: 'zh-en'|'en-zh'|'cloze'|'choice'|'contrast'|'imitation'|'term'|'replay';
  cardIds: string[];
  sourceContextIds: string[];
  prompt: string;
  choices?: string[];
  referenceAnswer: string;
  explanation: string;
  provenance: 'rule'|'model'|'user';
};

type PracticeAttempt = {
  id: string;
  itemId: string;
  answer?: string;
  outcome: 'correct'|'incorrect'|'self-pass'|'self-fail'|'skipped';
  durationMs: number;
  createdAt: string;
  scheduleMutationConsentId?: string;
};
```

生成命令携带 `requestId` 并以 `(requestId, itemIndex)` 幂等；模型结果必须通过 Zod schema，引用的 `cardIds` 只能来自输入白名单。取消信号沿统一 SDK 传递。

## 6. 路径设计

- 正常：选择来源 → 本地解析 → 预览题型和数量 → 确认 → 规则/模型生成 → 逐题作答与揭晓 → 原子写 attempt → 汇总。
- 失败：单题生成失败不丢已生成题；显示逐项错误，可重试或用较简单的规则题替代；无可用题时不创建空会话。
- 取消：生成时取消 SDK 请求并删除未提交草稿；作答中取消保留已完成 attempt，会话标记 `cancelled`，不写 FSRS。
- 重启：从最后一次持久化的 `active` session 恢复；未完成输入只有明确保存为草稿才恢复；重复提交由 attempt 幂等键拦截。

## 7. 安全与隐私

发给模型的内容仅包括本题所需卡片字段和最小上下文；页面原文视为不可信数据，prompt 明确其不得改变工具权限或输出协议。模型返回不得提供数据库 ID、URL 或写操作指令；所有 ID 由本地代码绑定。开放答案按纯文本渲染，禁止 `dangerouslySetInnerHTML`。日志不记录完整答案、网页正文或凭证。

## 8. 性能预算

- 100 张候选卡片的本地筛选与预览：P95 ≤ 200 ms。
- 规则题生成 20 题：P95 ≤ 150 ms。
- 启动练习后首题框架：≤ 200 ms；模型题等待时可先做已就绪题。
- 每次 attempt 写入：P95 ≤ 100 ms。
- 会话默认最多 50 题；超过时分批，避免一次生成和渲染全部内容。

## 9. 自动化测试

- Vitest：来源解析、题型模板、评分、幂等键、状态机及默认 `history-only` 不变量。
- Testing Library：键盘作答、揭晓、跳过、取消、来源跳转及状态播报。
- MSW：模型超时、结构错误、部分生成和取消；断言只经过统一 SDK adapter。
- fake-indexeddb：事务回滚、重启恢复、重复提交。
- Playwright：从 Again 记录创建练习，完成后验证练习历史增加且 FSRS 字段完全不变。

## 10. 逐步人工验收

1. 准备一张含 Again 记录和来源上下文的卡片，记录其 FSRS 全部字段。
2. 从错误页发起“错题回放 + 完形填空”，确认预览显示重点、题型和来源数量。
3. 断开 LiteLLM，确认规则题仍可开始，模型题可重试或替换，不出现空白页。
4. 完成一题后重启浏览器，确认可恢复会话并看到已完成记录。
5. 完成整组，逐题回到原卡片和原始上下文。
6. 比较步骤 1 的 FSRS 字段，确认全部未变化；练习历史新增且结果可读。
7. 在设置中启用未来的“影响排程”实验开关（若已实现），确认提交前有逐次影响说明和确认，取消后仍不改排程。

## 11. 交付物与完成标准

交付领域模型、仓储 migration、规则题工厂、统一生成 adapter、三类 UI、测试 fixtures 与验收记录。完成标准是上述自动化全绿、人工步骤可复现、默认不改 FSRS 的数据库快照证据存在，并且任何自研基础能力都有批准的 ADR。

## 12. 风险与待确认

- 模型题质量不稳定：首版优先规则题，模型结果可丢弃且不污染卡片。
- 练习历史膨胀：待真实使用决定保留策略，不先静默清理。
- 待确认：哪些练习值得显式影响 FSRS、每日题量、开放题是否需要候选深度反馈。

## 参考资料

- [ts-fsrs 官方仓库](https://github.com/open-spaced-repetition/ts-fsrs)
- [Zod 官方文档](https://zod.dev/)
- [React Aria Components](https://react-spectrum.adobe.com/react-aria/components.html)

