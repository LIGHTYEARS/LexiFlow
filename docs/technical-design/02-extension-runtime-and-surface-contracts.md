# 02 · 扩展运行时与界面载体契约

> 状态：拟实施（P0 运行时基线）  
> 对应 PRD：§5–7、§14、§16–17、§19.1/19.7  
> 依赖：《01 · 总体架构与技术基线》  
> 本文可独立用于实现和验收 content script、service worker、Popup、Side Panel 与 Dashboard 的生命周期及通信。

## 1. 范围与非目标

### 1.1 范围

- WXT entrypoint 与 MV3 manifest 的职责划分；
- 五类运行面之间的命令、查询、事件和错误契约；
- worker 随时终止、tab 导航、扩展升级和权限变化的恢复语义；
- 动态 LiteLLM origin 权限、站点启停和凭证隔离；
- surface 间一致的状态反馈与导航协议。

### 1.2 非目标

- 不描述选区算法与上下文提取细节（见文档 03）。
- 不定义数据库表和迁移（见文档 04）。
- 不定义模型 SDK、提示词和响应 schema。
- 不把 Popup、Side Panel 或 Dashboard 作为共享 DOM/React root；它们是独立文档，只共享 package 和协议。

## 2. 需求映射

| PRD 行为 | 运行时实现 | 人工观察点 |
|---|---|---|
| 页面选区只显示轻量入口 | content script 本地完成，不唤醒模型链路 | 选区后无模型网络与保存记录 |
| Popup 提供快速摘要 | Popup 查询 worker，失败时可直接打开 Dashboard | 数字与 Dashboard 一致 |
| Side Panel 汇总当前页 | 以 `tabId + canonicalUrl` 查询，不读取页面 React 状态 | 导航后自动切换页面摘要 |
| Dashboard 完整管理 | extension page 发类型化命令，不直接依赖当前 tab | 关闭网页仍可管理本地数据 |
| 快捷键打开/保存/关闭 | commands 由 worker 路由至 active tab 或 extension page | 与点击行为一致且可取消 |
| 浏览器重启不丢已确认数据 | 所有真相在持久层，worker 重启后重建 adapter | 终止 worker 后功能恢复 |

## 3. 运行面与职责

| Surface | WXT entrypoint | 生命周期 | 可拥有状态 | 禁止事项 |
|---|---|---|---|---|
| Background | `background.ts` | 事件驱动，可随时终止 | 单次事件局部状态、可重建连接 | 长驻队列、内存缓存作为真相、DOM |
| Content Script | `content.tsx` | 跟随 frame/document | 当前选区快照、UI machine、AbortController | 读取凭证、直连 Dexie、直调 LLM |
| Popup | `popup/` | 打开时创建、关闭即销毁 | 当前查询结果 | 长任务、未持久化草稿 |
| Side Panel | `sidepanel/` | 当前浏览器窗口内较长驻留 | 当前 tab/page 查询态 | 假设 active tab 不变 |
| Dashboard | `dashboard/` | 普通 extension page | 页面路由、表单草稿 | 绕过应用服务写 IndexedDB |

Content script 以 WXT ShadowRoot UI 挂载；Popup/Side Panel/Dashboard 使用共享 React 组件和 design tokens，但分别建立 root、error boundary 与数据查询实例。

官方依据：[WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints.html)、[Chrome sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)、[MV3 service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。

## 4. Manifest 与权限契约

### 4.1 基础权限

- `storage`：设置和受控元数据；领域数据仍在扩展 origin 的 IndexedDB。
- `commands`：明确触发解释、保存、打开复习、关闭页面 UI。
- `sidePanel`：当前页学习侧栏。
- `scripting`：在用户刚授予当前站点权限后注册并立即注入该 origin 的 content script；未授权 origin 不注册、不注入。

`optional_host_permissions` 声明 `http://*/*` 与 `https://*/*` 两类可申请范围，但安装时不取得访问权。网页阅读权限和模型连接权限由两个明确用例分别管理：

1. **PageAccessPolicy**：首次设置或 Popup 中由用户点击“启用当前站点”后，请求当前页面的精确 origin（例如 `https://developer.mozilla.org/*`）。WXT entrypoint 使用 `registration: 'runtime'` 产出 content bundle；授权成功后，使用 `chrome.scripting.registerContentScripts` 为该 origin 持久注册，并用 `chrome.scripting.executeScript` 让当前 tab 立即生效。启动和 `permissions.onAdded/onRemoved` 时根据已授予 origins 对注册表做幂等校准。撤销时先注销对应动态脚本、通知当前 tab 卸载 UI，再移除 host permission。P0 不声明覆盖所有网页的静态 content script，也不提供“一次启用所有网站”。生产 manifest 测试必须证明没有 `content_scripts.matches` 或 `host_permissions` 的广泛安装时授权。
2. **ModelOriginPermissionGateway**：保存/测试 LiteLLM 地址时，从经 URL schema 验证的 `baseUrl` 推导精确 origin，并在该用户手势内单独检查和请求。若同一 origin 已因网页访问被授予，`chrome.permissions.contains` 命中后无需重复弹窗，但审计记录仍标为模型连接用途。

拒绝任一权限不会丢弃设置草稿：页面显示“本站尚未启用”，模型连接显示“服务地址未授权”。修改 LiteLLM 地址时提示撤销不再使用的旧 origin；撤销阅读 origin 不自动删除已经采集的本地来源。

Chrome 要求权限请求必须由用户手势触发：[Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)。
WXT 支持由调用方负责注册的 runtime content entrypoint：[WXT runtime registration](https://wxt.dev/api/reference/wxt/interfaces/basecontentscriptentrypointoptions#registration)。

### 4.2 存储访问级别

扩展启动/安装时执行：

```ts
await chrome.storage.local.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS',
});
```

原因：`storage.local` 默认可暴露给 content scripts；凭证、模型地址和敏感设置只允许 trusted extension contexts 访问。content script 通过窄消息查询“当前站点是否启用”等最小派生值，不读取完整设置，也不拥有 IndexedDB 真相源。参考：[Chrome storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage)。

### 4.3 页面覆盖范围

- 已经 PageAccessPolicy 授权的普通 `http/https` 顶层 frame 为 P0；未授权站点由 Popup 提供启用入口，不进行页面注入。默认不注入 cross-origin iframe。
- `chrome://`、Chrome Web Store、浏览器内部页不允许运行，UI 应在 Popup 说明限制。
- `file://` 取决于用户显式浏览器授权；未授权时不报内部错误。
- 站点禁用规则优先于全局自动解释偏好。

## 5. 类型化消息契约

使用 `@webext-core/messaging` 定义唯一 `ProtocolMap`，每个 handler 入参和返回值再由 Zod 4 校验。统一 envelope 沿用文档 01 的 `protocolVersion/requestId/occurredAt`。

```ts
interface ProtocolMap {
  'selection/explain': (input: ExplainSelectionCommand) => ExplainAccepted;
  'selection/cancel': (input: { requestId: string }) => { cancelled: boolean };
  'capture/save': (input: SaveCaptureCommand) => SaveCaptureResult;
  'page/summary': (input: PageSummaryQuery) => PageSummary;
  'dashboard/counts': () => DashboardCounts;
  'settings/site-policy': (input: SitePolicyQuery) => SitePolicyView;
  'navigation/open': (input: OpenDestinationCommand) => void;
}
```

### 5.1 消息分类

- **Command**：可能改变状态，必须携带 `requestId`；返回最终提交结果或已接受的 job id。
- **Query**：无副作用；可重试，不承诺跨毫秒快照一致性。
- **Event**：只通知“可能已变化”，接收方重新查询；事件丢失不得造成数据错误。
- **Progress**：绑定 `requestId` 且单调递增；过期 surface 可忽略。

### 5.2 路由规则

- content script → worker：解释、取消、保存、站点策略。
- Popup/Side Panel/Dashboard → worker：特权查询、命令、导航。
- worker → 指定 tab/frame：解释进度、快捷键、关闭 UI；必须校验 tab/frame 是否仍属于原 document。
- worker 不广播完整学习内容；变化事件只带实体 id、revision 和类型。

禁止在业务组件中裸用 `chrome.runtime.sendMessage`/`onMessage`。浏览器 API 只存在于 runtime adapter；测试使用同一 `ProtocolMap` 的 fake transport，而非复制 handler。

## 6. Tab、Frame 与 Document 身份

网页导航会复用 `tabId`，因此仅靠 tabId 不能关联选区或晚到结果。页面会话使用：

```ts
type PageSessionRef = {
  tabId: number;
  frameId: number;       // P0 固定 0
  documentId: string;    // Chrome/WXT 可用时采用，否则 content 生成 session UUID
  urlAtCapture: string;
};
```

worker 回传前比较 `documentId`；已导航的旧结果返回 `STALE_DOCUMENT` 并丢弃。Side Panel 监听 active tab 和 navigation 变化，展示 skeleton 后重新查询；不会短暂把上一页条目显示为当前页。

## 7. 生命周期与恢复语义

Chrome MV3 worker 需按官方边界设计：空闲约 30 秒可被终止；单次 `fetch()` 响应等待超过约 30 秒可能终止；单个事件处理通常不得超过 5 分钟。实现不能用 timer 或未持久化全局变量“保活”。精确行为以目标 Chrome 版本实测为发布门禁，参考 [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。

### 7.1 正常路径

1. surface 发送有唯一 `requestId` 的消息。
2. worker 每次事件重新取得 settings/repository/adapter，校验权限和输入。
3. 只读查询直接返回；写命令在 Dexie 事务中提交幂等结果。
4. surface 收到结果并显示；必要时 worker 发轻量 invalidation event。

### 7.2 失败路径

- 消息端口不存在：surface 显示可重试错误，重新建立 transport 一次。
- 接收方 Zod 校验失败：返回 `INVALID_INPUT`；不执行任何副作用。
- 权限被撤销：返回 `PERMISSION_DENIED` 并引导设置页，不自动弹权限框。
- tab 已关闭/导航：停止发送，记录非敏感 diagnostic id。
- Popup 中途关闭：后台已提交的幂等写入可完成；仅查询/显示任务直接放弃。

### 7.3 取消路径

`selection/cancel` 是幂等命令。surface 立即进入 cancelled；worker 若仍存活则调用 SDK AbortSignal。取消与结果竞态以 worker 首个持久化终态为准：解释结果未产生写副作用，晚到结果一律不展示；保存一旦事务提交则返回真实保存结果，不能谎称取消成功。

### 7.4 重启路径

- **worker 重启**：下一消息重建服务；已确认写入从库中查到。未完成纯解释任务返回 `INTERRUPTED`，用户可重试。
- **浏览器重启**：只恢复已持久化数据、设置和明确提交的任务；不自动恢复旧页面浮层或未确认模型结果。
- **扩展更新**：迁移完成前 handler 返回 `UPGRADING`；迁移失败进入只读修复，不启用旧 handler 写新 schema。
- **长模型请求**：不得假设 worker 会持续 1–3 秒以外仍可靠；实现阶段需用真实 Chrome 验证。若超出生命周期，再通过 ADR 选择可见 extension page 或 offscreen document 承载，而非自制 keep-alive。

## 8. 各 Surface 契约

### 8.1 Content Script

- 只在有效、启用页面挂载一个 host；重新注入须检测并复用/替换，禁止重复 UI。
- ShadowRoot UI 使用隔离 tokens；不修改宿主页 class、全局 style、selection 内容。
- 处理选择、按钮、浮层的交互状态；站点规则由 worker 返回最小 view。
- 页面卸载时取消 listener、observer、Floating UI `autoUpdate` 和未完成请求。

### 8.2 Popup

- 首屏只展示今日待复习、逾期、Inbox、本周新增和入口。
- 每次打开重新查询，不因上次内存值显示“最新”。
- 模型设置中的“手动触发/自动解释”文案必须与 PRD 默认一致：默认手动触发。
- 复杂编辑跳转 Dashboard，不把 Popup 变成第二套管理页。

### 8.3 Side Panel

- 使用 `chrome.sidePanel`，显示当前页已采集、待确认和摘要。
- 没有可用当前页时显示空态；URL 规范化仅用于查询，始终保留原始来源 URL。
- 点击条目可打开详情；若原 tab 仍存在可定位来源，否则只展示已保存上下文。

### 8.4 Dashboard

- 承载 Inbox、卡片、来源、标签、错误、练习、统计、设置。
- URL route 可深链到 entity id，但加载后必须查询和鉴权，不信任 route 中展示内容。
- 批量和危险操作遵守确认、预览、逐项结果、撤销契约。

## 9. 安全与隐私

- untrusted content 与 trusted extension contexts 通过消息 schema 和最小 DTO 隔开。
- 任何 content script 消息都不能携带“已确认”布尔值冒充用户授权；确认令牌由 trusted UI/worker 生成并一次性消费。
- 凭证永不发送 content script；连接测试只返回分类结果和脱敏诊断。
- 消息日志不得包括 selection/context、模型文本、URL query、Authorization header。
- 外部导航使用 `tabs.create` 且仅允许 `https/http`；extension route 使用固定枚举。
- `sender.id`、tab/frame/document 与预期不一致时拒绝特权 handler。

## 10. 性能预算

| 路径 | p95 预算 | 降级 |
|---|---:|---|
| content script 启动 | CPU ≤ 50 ms | 延迟挂载 React，选区发生后再加载重 UI |
| 消息往返（无数据库） | ≤ 75 ms | 一次自动重连后提示重试 |
| Popup 可交互 | ≤ 300 ms | 先显示稳定骨架 |
| Side Panel tab 切换 | ≤ 300 ms 显示 skeleton，≤ 1 s 本地内容 | 保留空态，不显示旧页数据 |
| Dashboard 首屏 | ≤ 1 s 本地数据可用 | 路由级 lazy loading |

content script 不设置持续高频轮询；selection 事件去抖，observer 生命周期随页面 session 清理。

## 11. 自动化测试

- ProtocolMap 编译测试：请求/返回类型不匹配时构建失败。
- Zod 契约测试：缺字段、超长 payload、未知版本、不可信 URL 全部拒绝。
- runtime adapter 单元测试：sender/tab/document 校验和错误映射。
- Playwright 扩展 E2E：普通网页选区、Popup 数字、Side Panel 随 tab 切换、Dashboard 深链。
- worker 生命周期测试：使用扩展管理或 DevTools 终止 worker 后重试查询/幂等保存。
- 权限测试：请求、拒绝、授予、撤销动态 LiteLLM origin；拒绝时无网络请求。
- 安全测试：content script 尝试读取 WXT storage/发送伪确认消息均失败。
- 构建检查：manifest permissions/host_permissions 快照，新增权限必须显式审批。

## 12. 逐步人工验收

1. 加载打包扩展，检查 manifest：无常驻 background page、安装后尚未持有任意网页 origin；`optional_host_permissions` 只声明 `http/https` 可申请范围。
2. 在未授权网页打开 Popup 并点击“启用当前站点”；确认只请求该 origin、当前 tab 随即有划词能力，另一未授权站点没有注入。
3. 在未授权 LiteLLM origin 配置连接，点击“测试连接”前不弹权限；点击后才请求该精确 origin，拒绝后显示“未授权”。
4. 授予模型权限后测试连接；错误只显示类型，不显示 token；随后撤销权限并确认请求被阻止。
5. 在普通网页选区，确认只出现一个 ShadowRoot 按钮；刷新/历史导航后不重复挂载。
6. 打开 Popup、Side Panel、Dashboard；核对相同 Inbox/复习计数一致，Popup 关闭不影响后台真相。
7. Side Panel 打开时切换两个 tab；确认先 skeleton、再正确页面内容，无上一页闪现。
8. 触发解释后立即导航；确认旧结果不注入新页面。
9. 保存一次，终止 worker，再保存同一 `requestId`；确认返回相同结果且只一条数据。
10. 在 `chrome://extensions`、Chrome Web Store、禁用站点验证限制说明与无注入行为。
11. 检查 `chrome.storage.local` 的 access level，并从 content script console 验证无法读取受信设置。

## 13. 交付物与完成标准

- 五类 WXT entrypoint、最小 manifest 和按环境生成的 CSP；
- 单一 `ProtocolMap`、Zod schemas、browser runtime adapter、统一错误映射；
- 动态 origin 权限流程和 trusted storage access 初始化；
- tab/frame/document session 判定与 stale result 丢弃；
- worker 重启、权限撤销和 navigation 竞态自动化测试；
- 人工验收记录含 Chrome 版本、构建 hash、manifest、截图与 network 证据。

完成标准：surface 不直接读取凭证/领域数据库、不绕开类型化协议，任意终止 worker 不损坏已确认数据，权限只由明确用户手势获取。

## 14. 风险与待确认

| 风险/问题 | 处理 | 决策点 |
|---|---|---|
| worker 对流式模型请求的生命周期不足 | 可取消、超时、解释任务可重试且无副作用 | 用真实 LiteLLM 延迟分布决定是否引入 offscreen document ADR |
| 逐站授权增加首次使用步骤 | Popup 提供单击启用当前站点；授权后该 origin 持续可用 | 用真实使用衡量步骤成本；P0 不扩成一次授权所有网站 |
| iframe 内选区 | P0 只顶层 frame | 真实使用证明需要后再设计 frame 聚合 |
| Side Panel 支持版本 | Chrome 116+ 满足 API 基线 | 不在首版兼容旧版 Chrome |
| storage access API 可用性/初始化失败 | 启动时校验，失败则禁用凭证操作 | 是否需 session-only 凭证模式 |

## 15. 参考资料

- [Chrome Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome commands](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [WXT content scripts](https://wxt.dev/guide/essentials/content-scripts.html)
- [webext-core messaging](https://webext-core.aklinker1.io/messaging/installation)
