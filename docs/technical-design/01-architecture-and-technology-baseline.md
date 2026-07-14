# 01 · 总体架构与技术基线

> 状态：拟实施（P0/P1 共用基线）  
> 对应 PRD：§2–5、§10、§14–17、§19–20  
> 目标浏览器：Chrome 116+，Manifest V3  
> 本文可独立用于架构评审、仓库初始化和技术门禁验收。

## 1. 范围与非目标

### 1.1 范围

本文确定 LexiFlow Chrome 扩展的运行面、模块边界、依赖准入、跨上下文通信、持久化分层、质量门禁与全局非功能预算。所有后续技术方案必须遵守本文；发生冲突时先通过 ADR 修改本文，不得在业务实现中暗自绕过。

### 1.2 非目标

- 不定义卡片字段、数据库索引和迁移步骤；见《04 · 领域模型、本地存储与迁移》。
- 不定义模型提示词与流式协议；由模型接入方案负责。
- 不固定视觉色值和字号；由 UI 系统方案负责。
- 不包含多用户、云同步、移动端、公开商店发布、全文自动扫描、PDF/OCR。
- PRD §13 的开放式表达反馈仍是候选能力，不得因预留接口而进入 P0/P1。

## 2. 需求映射

| 需求 | 架构约束 | 验证证据 |
|---|---|---|
| 阅读时明确触发，不因选区自动请求 | content script 只采集选区并渲染轻量按钮；模型请求必须经过显式命令 | 选区后网络为零；点击/快捷键后才产生请求 |
| 本地保存、可恢复、可迁移 | IndexedDB 保存领域数据；扩展设置单独存储；完整备份可恢复 | 重启、升级、导入/恢复测试 |
| 用户保有最终决定权 | 写命令统一经领域服务校验，危险动作不得从 UI 直接写库 | 高风险命令无确认令牌时被拒绝 |
| 原始证据可追溯 | 原始选区与来源为不可被生成结果覆盖的独立实体 | 编辑生成内容后来源仍可回看 |
| 页面不可信 | 页面 DOM 只作为输入，不能调用扩展特权或改变产品规则 | 注入指令样本不会触发写操作 |
| MV3 重启可靠 | service worker 无内存真相；任务与写入均可恢复/幂等 | worker 被终止后重新操作无数据损坏 |

## 3. 技术基线与版本策略

| 能力 | 选择 | 使用边界 |
|---|---|---|
| 扩展框架 | WXT + React + TypeScript strict | WXT 负责 entrypoint、manifest、构建和浏览器 API facade |
| 浏览器基线 | Chrome 116+ / Manifest V3 | 不为 MV2 或 Firefox 首版兼容牺牲边界清晰度 |
| 页面内 UI | WXT `createShadowRootUi` | UI 样式与宿主页隔离；禁止向页面 React 树挂载 |
| 定位 | `@floating-ui/react` | 使用 `inline`、`flip`、`shift`、`autoUpdate`；禁止自研碰撞引擎 |
| 页面正文提取 | `@mozilla/readability` | 在克隆文档上执行；选区邻域为首要证据，Readability 为文章级补充 |
| 复杂状态 | XState v5 + `@xstate/react` | 仅用于选区解释、批量操作等有取消/重试/恢复的复杂流程 |
| 领域数据 | Dexie 4 / IndexedDB | Repository 是唯一读写入口；禁止组件直接操作表 |
| 设置 | WXT typed storage | 只存小型设置、站点规则和 schemaVersion；禁止存大对象/历史 |
| 通信 | `@webext-core/messaging` + Zod 4 | 编译期类型 + 运行时解析；禁止裸 `runtime.sendMessage` 散落业务代码 |
| 模型 | AI SDK Core `ai` + `@ai-sdk/openai-compatible` | 用 SDK 访问 LiteLLM；禁止手写 `fetch`、SSE parser、SDK 已提供的重试/错误映射 |
| 测试 | Vitest + Testing Library + MSW + fake-indexeddb + Playwright | 单元、契约、扩展 E2E 分层 |

依赖使用当前稳定主版本并锁定精确解析结果；升级由自动化测试、变更日志审阅和人工冒烟共同通过后合入。不得使用 `latest` 作为可复现构建依据。

官方依据：[Chrome MV3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)、[WXT](https://wxt.dev/)、[WXT Shadow Root UI](https://wxt.dev/guide/essentials/content-scripts.html#shadow-root)、[Dexie API](https://dexie.org/docs/API-Reference)、[Zod](https://zod.dev/)、[XState](https://stately.ai/docs/xstate)。

## 4. SDK-first / library-first 决策规则

能力选型顺序为：

1. 官方 SDK 或标准浏览器能力完整覆盖；
2. 活跃维护、许可兼容、体积与安全可接受的成熟依赖；
3. 对依赖增加一层薄的领域适配器，隔离第三方类型与错误；
4. 仅当前三项无法满足时自研最小能力。

明确禁止：

- 手写 `fetch` 调用 LLM endpoint 或解析 SSE；
- 自研通用浮层定位、正文抽取、RPC、IndexedDB ORM、CSV parser、调度算法；
- 复制依赖源码后形成无人跟进的内部 fork；
- 以“代码很短”为由绕过成熟库已处理的异常、兼容性与安全边界。

### 4.1 自研例外 ADR 模板

任何例外须在实现前提交 ADR，并包含：能力与范围、至少两个候选及版本、拒绝原因（安全/许可/兼容/体积/维护）、最小自研表面积、测试证据、负责人、复审日期、替换路径。未通过 ADR 的自研实现不得合并。领域特有的查重风险策略、来源溯源规则和 Inbox 决策属于业务逻辑，不视为“重复造通用轮子”。

## 5. 总体组件与信任边界

```text
不可信网页 DOM
  ↕ Selection Adapter（只读、最小提取）
Content Script + ShadowRoot UI
  ↕ typed message + Zod envelope
MV3 Service Worker（命令编排、权限边界）
  ├─ Domain Services ─ Repository ─ IndexedDB/Dexie
  ├─ Settings Gateway ─ WXT storage
  └─ LLM SDK Adapter ─ 用户配置的 LiteLLM

Extension Pages
  ├─ Popup（摘要/入口）
  ├─ Side Panel（当前页）
  └─ Dashboard（管理/复习/设置）
       ↕ 与上方相同的 typed message / Repository 边界
```

### 5.1 所有权

- **Content Script**：选区检测、最小上下文采集、触发按钮/浮层、对当前 tab 生命周期响应。无数据库所有权。
- **Service Worker**：跨上下文命令、特权 API、模型任务编排、幂等写入；不依赖长驻内存。
- **Extension Pages**：展示与用户意图采集，不直接信任 route/query 参数。
- **Domain Services**：不依赖 DOM/React/Chrome，执行确认规则、来源溯源、幂等性和不变量。
- **Repository/Settings Gateway**：封装数据结构、事务和迁移；UI 不感知 Dexie 表结构。
- **Adapters**：第三方 SDK 与领域类型之间的薄层，可替换但不重复实现 SDK。

## 6. 跨模块协议基线

所有命令与事件使用版本化 envelope：

```ts
type MessageEnvelope<TType extends string, TPayload> = {
  protocolVersion: 1;
  type: TType;
  requestId: string;       // crypto.randomUUID()
  tabId?: number;
  occurredAt: string;      // ISO 8601 UTC
  payload: TPayload;
};

type Result<T> =
  | { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string; error: AppError };

type AppError = {
  code: 'INVALID_INPUT' | 'PERMISSION_DENIED' | 'NOT_FOUND' |
        'CONFLICT' | 'OFFLINE' | 'TIMEOUT' | 'CANCELLED' |
        'MODEL_UNAVAILABLE' | 'STORAGE_FAILURE' | 'INTERNAL';
  userMessage: string;
  retryable: boolean;
  diagnosticId?: string;
};
```

约束：所有入站消息先经 Zod `safeParse`；日志只记录 `type/requestId/code/duration`，不得记录凭证、完整选区或模型正文。跨边界的 `Date`、`URL` 统一序列化为字符串；协议变更只能向后兼容新增可选字段，破坏性修改提升 `protocolVersion`。

## 7. 全局运行路径

### 7.1 正常路径

1. content script 检测稳定有效选区并显示按钮；不发网络请求。
2. 用户明确触发，UI 立即进入稳定 loading shell。
3. content script 采集最小上下文，经类型化消息发送命令。
4. worker 调模型 adapter；结果经 schema 验证后返回 UI。
5. 用户执行保存；领域服务使用 `requestId` 幂等提交事务。
6. extension pages 通过领域事件或重新查询刷新视图。

### 7.2 失败、取消和重启

- 页面上下文不足：只传选区并标记 `contextQuality=selection_only`。
- 模型失败：可重试或以原始证据保存 Inbox；不得伪造完整卡片。
- 用户取消：adapter 接收 AbortSignal；晚到结果按 `requestId` 丢弃且不得写库。
- worker 被 Chrome 终止：未确认的解释不恢复；已收到的写命令通过幂等键安全重试。设计时显式考虑 Chrome 约 30 秒空闲终止、约 30 秒 fetch 响应等待和单任务约 5 分钟的边界，不用 keep-alive hack 绕过。
- 数据库错误：展示失败，不得先显示成功；事务回滚。
- 扩展更新：先完成可恢复迁移再启动业务入口，失败则保留升级前备份并进入只读修复页。

Chrome 官方说明 service worker 可被终止，故不能依赖全局变量保存状态：[Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。

## 8. 安全与隐私

- 最小权限：初始只申请确需的 `storage`、`commands`、`sidePanel`、`scripting`；网页 content script 只覆盖用户逐站启用的 `http/https` origin。
- 网页 PageAccessPolicy 与模型 ModelOriginPermissionGateway 是两个独立用例：前者在 Popup 明确启用当前站点，后者在保存/测试 LiteLLM 地址时请求精确服务 origin；二者都通过 `optional_host_permissions` 和用户手势内的 `chrome.permissions.request` 获取，不把任意地址固化为默认 host 权限。
- 启动时将 `chrome.storage.local` access level 设为 `TRUSTED_CONTEXTS`；content script 不读取凭证、完整设置或 IndexedDB 真相源，只查询最小派生视图。
- 页面 DOM、URL、导入文件、模型输出均为不可信输入；进入领域层前解析、限长、规范化。
- 页面文字中的“忽略规则/执行操作”只作为学习材料；提示词明确分隔指令与引用内容。
- 凭证只存扩展受控存储，通过 adapter 注入；不得进入 DOM、错误详情、导出或 telemetry。
- 不引入云端 analytics；诊断信息默认本地、可清除、内容最小化。
- Shadow DOM 是样式隔离而非安全沙箱；禁止 `dangerouslySetInnerHTML`，链接必须验证 `http/https`。
- Content Security Policy 禁止远程脚本和 `eval`；依赖随包构建。

## 9. 性能预算

| 指标 | 预算（开发机 p95） | 测量点 |
|---|---:|---|
| 选区稳定至按钮可见 | ≤ 200 ms | `pointerup/selectionchange` 至首次 paint |
| 明确触发至浮层框架可见 | ≤ 200 ms | click/command 至 shell paint |
| content script 首次注入执行 | ≤ 50 ms CPU | Chrome Performance trace |
| 页面内 UI 压缩后 JS | ≤ 180 KB（不含共享缓存） | build analyzer |
| 跨上下文本地命令 | ≤ 100 ms p95 | request/response timestamps |
| 普通本地保存事务 | ≤ 100 ms p95 | repository instrumentation |
| 页面主线程长任务 | 单次 < 50 ms | PerformanceObserver |

模型首结果 1–3 秒是端到端体验目标而非前端同步等待；所有模型任务均可取消，保存与关闭不等待模型。

## 10. 自动化测试与质量门禁

- `tsc --noEmit`、ESLint、格式检查、生产构建必须通过。
- 依赖扫描验证许可证、已知高危漏洞、锁文件一致性，并阻止裸 LLM `fetch`、裸 `chrome.runtime.sendMessage`、组件直连 Dexie 表。
- Vitest：领域不变量、Zod 协议、错误映射、幂等键、设置默认值。
- fake-indexeddb：事务、升级、重启后的持久化。
- MSW：只在 adapter 边界模拟 SDK 所见网络，不复刻 SDK 内部实现。
- Playwright persistent context：真实打包扩展，覆盖 content script、popup、side panel、dashboard、worker 重启。
- 每个发布构建输出 manifest 权限 diff、bundle 体积、迁移测试和 E2E 报告。

## 11. 逐步人工验收

1. 在全新 Chrome 116+ profile 加载生产构建；确认没有非必要权限提示。
2. 打开普通英文网页，选中文本；确认 200 ms 目标内仅出现触发按钮，Network 无模型请求。
3. 点击按钮；确认先出现稳定浮层，再出现模型结果；关闭/滚动不阻塞页面。
4. 取消请求；确认状态为已取消，稍后无结果回填、无数据写入。
5. 模拟 LiteLLM 不可用；确认可把原文与来源保存 Inbox，错误不含凭证。
6. 保存后从扩展管理页终止 service worker，再打开 Dashboard；确认记录存在且重试不重复。
7. 打开禁用站点、`chrome://` 页面和复杂编辑器；确认正确不运行或降级，不破坏页面。
8. 搜索构建产物和日志：不存在远程脚本、明文凭证、未经批准的 analytics。
9. 审阅依赖清单；随机选择一项自研通用能力，必须能关联已批准 ADR，否则验收失败。

## 12. 交付物与完成标准

- WXT 工程、MV3 manifest、四类 entrypoint 的最小可运行骨架；
- `domain`、`application`、`adapters`、`infrastructure` 的依赖方向由 lint 规则约束；
- 共享协议包和统一 `AppError`；
- 依赖准入与 ADR 模板、CI 门禁、bundle/权限报告；
- 架构级单元和真实扩展冒烟通过；
- 人工验收 9 步有日期、构建 hash 和证据截图/日志。

只有以上全部完成，且不存在组件绕开领域服务写库、直接调用 LLM 或以驻留内存为真相，本文才可标记“已实施”。

## 13. 风险与待确认

| 项目 | 当前处理 | 待确认 |
|---|---|---|
| host 权限范围 | P0 固定逐站请求；网页访问与 LiteLLM 服务访问分开校验和审计 | 仅根据真实使用数据在后续 ADR 评估是否增加批量授权 |
| bundle 体积 | 依赖按 entrypoint 拆分，Dashboard 延迟加载 | 真实构建预算是否需调整 |
| worker 终止 | 无内存真相、幂等写入 | 长模型流是否移至 extension page/offscreen document，需实测决定 |
| 新内容去向 | 架构同时支持 Inbox/低风险直存 | PRD §21 尚待真实使用确认 |
| 浏览器扩展 | 保持 browser adapter 边界 | Firefox 支持不进入当前里程碑 |

## 14. 参考资料

- [Chrome Extensions Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome extension security](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [Chrome Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [WXT documentation](https://wxt.dev/)
- [webext-core messaging](https://webext-core.aklinker1.io/messaging/installation)
- [WXT storage](https://wxt.dev/storage)
- [Floating UI](https://floating-ui.com/docs/react)
- [Mozilla Readability](https://github.com/mozilla/readability)
- [AI SDK OpenAI-compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers)
