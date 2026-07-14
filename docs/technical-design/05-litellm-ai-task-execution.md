# 05 LiteLLM AI 任务执行

## 文档状态

- 状态：拟定，可进入实现评审
- 适用范围：P0 快速解释、完整分析、Inbox 重新分析；P1 Inbox 整理与专项练习生成
- 依赖：`ai`、`@ai-sdk/openai-compatible`、Zod 4、`@webext-core/messaging`、Dexie 4
- 上游：选区捕获与上下文提取、设置中的 LiteLLM 连接
- 下游：采集决策、Inbox、专项练习

本文规定所有模型任务的统一执行边界。**禁止直接 `fetch` LiteLLM/LLM endpoint，禁止手写 SSE parser，禁止重复实现 SDK 已提供的重试、流协议或协议错误映射。**

## 1. 范围与非目标

### 1.1 范围

- 使用 AI SDK 的 OpenAI-compatible provider 连接用户配置的 LiteLLM。
- 为任务提供类型化请求、Zod 4 结构化输出、流式状态、取消、超时与错误归类。
- 记录不含凭证和敏感正文的任务诊断元数据。
- 保证取消、重试、浏览器重启不会把陈旧结果写入知识库。

### 1.2 非目标

- 不提供模型路由、计费或 LiteLLM 服务端运维。
- 不在选区形成时自动调用模型；默认必须点击触发按钮或使用快捷键。
- 不让模型直接执行卡片合并、删除、覆盖用户内容或修改 FSRS。
- 不把开放式表达反馈纳入当前交付；PRD 将其标记为候选能力。

## 2. 需求映射

| PRD | 设计响应 |
|---|---|
| 3.1、6.1、7.1–7.2、19.1 | 选区仅产生本地 `selection.available`；`aiTask.start` 只接受明确触发产生的 intent |
| 7.3–7.6、16.2 | 稳定骨架、可取消、失败可重试，原文仍可存 Inbox |
| 10、18.1 | 模型只输出建议；高风险写操作必须进入确认流程 |
| 14.1–14.2 | LiteLLM 地址、凭证、模型和任务提示词可配置并可测试 |
| 15.1、19.7 | 最小化发送上下文；诊断与错误不得包含完整凭证 |
| 17.1–17.2 | 首个有用结果目标 1–3 秒；重试不得重复写入 |

## 3. 关键决策与备选

### D1：AI SDK Core + OpenAI-compatible provider

以 `createOpenAICompatible({ baseURL, apiKey })` 创建 provider，通过 `streamText` 或 SDK 的结构化输出能力执行任务；schema 由 Zod 4 定义。AI SDK 官方提供 OpenAI-compatible provider、流式生成和结构化输出能力：[provider](https://ai-sdk.dev/providers/openai-compatible-providers)、[AI SDK Core](https://ai-sdk.dev/docs/reference/ai-sdk-core)。

- 未选 OpenAI 官方 SDK：LiteLLM 是可配置 OpenAI-compatible 服务，AI SDK provider 更适合浏览器端统一的结构化和流式任务抽象。
- 未选手写 `fetch`：会重复处理 SSE、取消、响应协议和 provider 差异，且违反 SDK-first 原则。
- 例外：SDK 缺失的 LiteLLM 专属管理 API必须单独 ADR，列出候选依赖、拒绝理由、最小范围和替换计划；不得借机绕过本文的 LLM 推理通道。

### D2：任务执行与领域写入分离

AI executor 只产出不可变 `AiTaskResult`。Capture/Inbox/Practice 服务验证结果后决定是否暂存；正式卡片的高风险变化仍需用户确认。

### D3：后台拥有任务，页面只拥有展示

扩展 trusted context 持有任务注册表与 AbortController，并在该上下文调用 AI SDK；content script、Popup、Dashboard 使用 `@webext-core/messaging` 发送受限命令和订阅进度。content script 不读取凭证、LiteLLM baseURL 或主数据库。LiteLLM origin 必须由用户在设置页手势授权，页面消息绝不能携带 baseURL。MV3 worker 可能终止，因此只把已验证的终态和必要诊断持久化，不承诺跨 worker 重启恢复网络流。

## 4. 组件边界

```text
UI explicit intent
  -> Typed Messaging Gateway
  -> AiTaskCoordinator
       -> TaskPolicy (task/model/prompt/context budget)
       -> LiteLlmProviderFactory (AI SDK adapter)
       -> StructuredResultValidator (Zod 4)
       -> TaskJournal (Dexie metadata only)
  <- progress/result/error/cancelled
  -> domain service previews proposed mutation
  -> user confirmation when required
```

- `AiTaskCoordinator`：状态、取消、幂等和陈旧结果抑制。
- `LiteLlmProviderFactory`：唯一可接触 LiteLLM 配置的薄 adapter；不暴露凭证。
- `TaskPolicy`：按任务选择模型、提示词版本、最大上下文和超时。
- `StructuredResultValidator`：只接受 schema 通过的终态；增量文本不可直接写库。
- `TaskJournal`：仅保存 taskId、类型、状态、时间、模型别名、提示词版本、错误码和内容哈希。

## 5. 领域、数据与消息契约

```ts
type AiTaskType =
  | 'quick-explain'
  | 'full-analysis'
  | 'inbox-reanalysis'
  | 'inbox-organize'
  | 'practice-generate';

type AiTaskState =
  | 'queued' | 'streaming' | 'validating'
  | 'succeeded' | 'failed' | 'cancelled' | 'superseded';

interface AiTaskRequest {
  taskId: string;             // UUID
  requestId: string;          // 一次 UI 请求，用于晚到响应抑制
  idempotencyKey: string;     // intent + input hash + prompt version
  intentId: string;           // 明确点击或快捷键产生
  type: AiTaskType;
  input: { selectedText: string; context?: string; pageTitle?: string };
  modelProfileId: string;
  promptVersion: string;
}

interface AiTaskResult<T> {
  taskId: string;
  schemaVersion: number;
  value: T;
  provenance: { kind: 'model-generated'; taskId: string; promptVersion: string };
}
```

消息命名：

- `aiTask.start(request) -> { accepted, taskId }`
- `aiTask.cancel({ taskId, reason }) -> { state }`
- `aiTask.getStatus({ taskId }) -> snapshot`
- `aiTask.event -> queued | delta | validating | succeeded | failed | cancelled`
- `aiTask.testConnection({ profileId }) -> redacted diagnostic`

所有消息入站与模型终态都用 Zod 校验。消息仅携带 `modelProfileId`，不携带 baseURL、apiKey 或任意 headers；trusted context 根据 profileId 读取配置。`delta` 仅供展示，不满足领域 schema，也不允许保存为正式解释。

## 6. 状态机与执行算法

```text
idle --explicit start--> queued --> streaming --> validating --> succeeded
                              |          |             |
                              +----------+-------------+--> failed
                              +--cancel/supersede----------> cancelled/superseded
```

1. 验证 `intentId`、任务类型、连接 profile 和输入长度。
2. 以规范化输入哈希、任务类型、提示词版本组成 `idempotencyKey`。
3. 同 key 的活动任务直接返回原 taskId；新 intent 可显式 supersede 旧任务。
4. 按最小必要原则裁剪上下文，并将网页指令视为不可信数据。
5. 调用 AI SDK；通过 SDK 的 `AbortSignal` 取消。
6. 流式 delta 更新 UI，但终态必须通过 Zod 4 schema。
7. 写入任务终态，然后向调用方返回不可变结果。
8. 领域服务创建保存预览；模型结果本身不执行知识库变更。

## 7. 路径设计

### 正常路径

明确触发 → 200ms 内展示浮层框架 → SDK 建流 → 展示增量 → Zod 验证 → 显示解释与查重入口 → 用户决定保存。

### 失败路径

- 网络/认证/模型不存在/限流/服务错误：使用 SDK error 保留原 cause，映射为稳定产品错误码；UI 不显示凭证、请求头或完整响应。
- schema 不通过：`INVALID_MODEL_OUTPUT`，不得伪造缺失字段；允许重试或保存原文到 Inbox。
- 超时：由协调器触发 AbortSignal，结果标为 `TIMEOUT`。
- 保存失败：AI 成功与领域写入失败分开显示，不得显示“已保存”。

### 取消路径

取消立即标记 task generation；调用 SDK abort。之后抵达的 delta/终态因 generation 不匹配被丢弃，不更新 UI、不写领域表。

### 重启路径

重启后把遗留 `queued/streaming/validating` 日志标记 `INTERRUPTED`。用户可重试；相同 idempotency key 不会直接写两次。网络流不伪恢复。

## 8. 幂等与事务

- AI 任务幂等只避免重复执行/重复消费，不替代领域保存幂等。
- 任务终态单表原子更新；不得把网络 await 放进 Dexie 写事务。
- 领域消费通过 `consumedResult(taskId, consumer, mutationId)` 唯一键去重。
- 提示词版本和 schema 版本随结果保存，便于回溯；用户自定义提示词升级不被覆盖。

## 9. 安全与隐私

- 凭证只从扩展受控设置读取，不进入页面 DOM、消息事件、日志、导出和截图。
- content script 不获得 apiKey、baseURL 或主库访问能力；请求只在 extension trusted context 发起。
- LiteLLM origin 由设置页明确用户手势授权；host permission 变化需重新连接测试，不能信任网页传入 origin。
- 发送前展示/记录上下文字段类别，默认仅选区、相邻句/段、标题和 URL。
- 页面正文可能包含 prompt injection；以不可信引用数据包裹，不允许改变工具权限或自动操作策略。
- 模型输出统一标记 `model-generated`，不得伪装网页原文。
- CSP、host permission 和 LiteLLM 地址变更应在平台/安全 TDD 中约束。

## 10. 性能预算

- 明确触发后浮层框架：P95 ≤ 200ms（不等待网络）。
- SDK 调用开始：验证后 ≤ 100ms。
- 本地模型正常时首个有用内容：目标 1–3s；超时默认 30s，可配置安全范围。
- 增量事件 UI 合并刷新 ≤ 10 次/秒，避免页面抖动。
- 诊断记录每任务目标 < 2KB，不保存完整提示词、正文或响应。

## 11. 自动化测试

- 单元：任务状态机、输入裁剪、错误映射、generation 抑制、Zod schema。
- 契约：以 AI SDK mock provider 验证正常流、碎片流、无效结构、SDK error、abort；不得通过 mock `fetch` 锁定底层协议。
- 集成：`@webext-core/messaging` 请求/事件，Dexie 任务日志和消费幂等。
- E2E：选区后断言零模型调用；点击后发起一次；取消后无陈旧内容；失败仍可进 Inbox；敏感字段不进入 UI/日志。
- 静态门禁：禁止业务代码出现指向模型 endpoint 的 `fetch`、EventSource 或自研 SSE parser；依赖审计确认仅 provider adapter 调用 AI SDK。

## 12. 人工验收

1. 清空网络记录，网页选中单词，等待并滚动：只有触发按钮，LiteLLM 请求数为 0。
2. 点击按钮：浮层框架立即出现，随后显示结构化解释。
3. 在生成中点击取消：状态显示已取消；等待 30 秒，旧结果仍不出现。
4. 断开 LiteLLM：错误能区分不可访问；原文可保存到 Inbox。
5. 配置错误 key、错误模型和超时场景：错误可操作，界面/日志无完整 key。
6. 令模型返回非 schema 内容：显示结果不可用，不创建完整卡片。
7. 连续双击触发与重复保存：每个 intent 状态明确，不生成重复卡片。
8. 生成中关闭浏览器再打开：任务显示中断，可重试，无假成功。
9. 检查构建产物：不存在业务自研 SSE parser 或 LLM raw fetch。

## 13. 交付物与完成标准

- AI SDK provider adapter、任务协调器、任务策略、Zod schemas、类型化消息。
- 脱敏诊断、连接测试、取消/重启处理。
- 单元、契约、扩展 E2E 和禁止 raw fetch 的静态门禁。
- 完成标准：上述自动化通过，人工验收 1–9 有记录；快速解释、Inbox 与练习消费者只读取已验证结果；无 SDK-first 例外或例外已有批准 ADR。

## 14. 风险与待确认

- LiteLLM 部署对 AI SDK OpenAI-compatible 能力的支持差异：以连接测试和契约套件验证。
- 浏览器端 provider bundle 体积：实现后测量，若超预算先 tree-shaking，不以手写协议替代。
- 待确认：各任务默认模型、超时、上下文上限、重试策略；不得用实现便利代替产品选择。
- 待确认：是否允许用户开启“选区后自动解释”；默认关闭。

## 15. 官方参考

- [AI SDK OpenAI-compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers)
- [AI SDK Core reference](https://ai-sdk.dev/docs/reference/ai-sdk-core)
- [Zod](https://zod.dev/)
- [webext-core messaging](https://webext-core.aklinker1.io/messaging/installation)
- [LiteLLM documentation](https://docs.litellm.ai/)
