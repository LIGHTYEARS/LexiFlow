# 11 安全、隐私与权限技术方案

## 文档状态

- 状态：拟实施；所有 P0/P1 功能的横切发布门禁
- 对应范围：PRD 3.3–3.6、7.5、10、14.1、15、17.2、18、19.7
- 威胁边界：个人本地扩展不等于可信环境；网页、模型、导入文件、LiteLLM 服务及 content script 所在页面均视为不同信任域

## 1. 范围与非目标

本文定义 Manifest V3 权限、动态 LiteLLM host 授权、凭证隔离、跨上下文消息认证、prompt injection 防护、任意 URL 代理防护、安全输出、日志脱敏、依赖与 CSP 门禁。

非目标：不保证用户配置的 LiteLLM 或其上游模型不留存数据；不实现硬件密钥或多用户权限；不通过“仅本地使用”豁免安全控制；不对任意网页提供通用网络代理。

## 2. 需求映射

| 产品要求/风险 | 控制 | 验证 |
|---|---|---|
| 只发送最小上下文 | 请求 builder 字段白名单与长度预算 | MSW 检查请求体 |
| 动态 LiteLLM 地址 | `optional_host_permissions` + `chrome.permissions.request` | 未授权、授权、撤销三路径 |
| 凭证不泄露 | trusted-context storage access + background-only credential service | content script 无法读取/返回 key |
| 页面指令不改变规则 | 页面文本标记为不可信数据，固定系统约束 | 注入语料红队测试 |
| 不做代理 | background 仅使用可信设置中已验证、已授权的 LiteLLM base URL | 页面可控 URL 全部拒绝 |
| 输出安全 | 结构化 schema + React 文本渲染 | XSS payload 显示为文本 |
| 本地可恢复 | 备份排除凭证并显示声明 | 搜索导出文件无 key |

## 3. 关键决策与备选

1. **最小静态权限。** `permissions` 只含产品实际需要的 `storage`、`sidePanel`、`scripting` 等。页面访问和 LiteLLM 访问都从 `optional_host_permissions` 声明的 `http://*/*`、`https://*/*` 可申请范围中，仅按用户手势请求精确 origin；网页脚本通过动态注册限定到已授权 origin，不存在覆盖所有网页的静态 content script。Chrome 要求权限请求由用户手势触发。
2. **凭证仅在可信扩展上下文可取。** `chrome.storage.local` 默认可能对 content scripts 暴露，因此初始化时设置 `chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})`；content script 只提交无凭证的领域命令，background/service worker 在调用 SDK 的瞬间读取 key。备选在消息中传 key，否决。
3. **LLM 仅通过统一 SDK adapter。** 使用 `ai` + `@ai-sdk/openai-compatible`；禁止 raw `fetch` LLM endpoint、手写 SSE parser、手写 SDK 已覆盖的重试。端点、认证和错误映射只在 adapter 内。
4. **可信 base URL，而非页面可控 URL。** 设置页允许规范化的 `https://host[:port][/path-prefix]`，以及用户明确确认的 localhost HTTP；拒绝 userinfo、query、fragment 和非 HTTP(S) scheme。host permission 以其 origin 申请，AI SDK 使用可信设置保存的完整 base URL 兼容 LiteLLM 路径前缀。页面消息不得携带 URL、headers、method 或 path。
5. **网页与模型均不可信。** 网页文本只进入 `<page_content>` 数据槽；模型只能返回 Zod 结构，不拥有工具调用或写权限。所有数据库 ID、操作目标与风险级别由本地代码决定。
6. **库优先。** Zod 校验协议、React 默认 escaping/React Aria 交互、Web Crypto 摘要；不得自研 sanitizer、加密、URL parser。缺口需 ADR。

## 4. 组件与信任边界

- 页面世界：完全不可信，不可调用扩展内部函数。
- WXT ShadowRoot content UI：只持有当前选区的最小快照；不能读取 credential store。
- typed messaging adapter：消息 schema、枚举命令、大小限制、sender/context 校验；禁止 `proxyRequest(url, options)` 形态。
- background `CredentialService`：唯一读取凭证的模块；禁止返回原值。
- `ModelEndpointPolicy`：规范化/比对 origin、权限状态和 HTTPS/localhost 规则。
- `LLMGateway`：唯一调用 AI SDK，接收领域 DTO，不接收任意 URL/header。
- Dashboard/Popup/Side panel：可信扩展页面，但仍不把 key 放入 DOM、URL、日志或错误对象。
- repository/export：学习数据与秘密分库/分 namespace；备份 adapter 默认排除秘密。

## 5. 协议契约

```ts
type ExplainCommand = {
  requestId: string;
  selection: string;
  context?: { before?: string; sentence?: string; after?: string; title?: string };
  source: { origin: string; urlWithoutFragment: string };
  task: 'quick-explain';
};

type ModelConnection = {
  origin: string;       // normalized origin only
  model: string;
  credentialRef: string; // opaque local reference, never secret
};
```

禁止字段：`url`, `path`, `method`, `headers`, `apiKey`, `fetchOptions`。消息最大 64 KiB；选区/上下文有独立字符上限。来源 URL 只用于 provenance，绝不用于 background 网络目标。

权限流程：设置页用户点击“授权并测试” → 解析 `new URL` → 去除 path/query/fragment → 校验协议和 localhost 例外 → `chrome.permissions.request({origins: [originPattern]})` → 保存 origin → SDK 连接测试。修改 origin 必须重新授权；撤销权限后模型功能降级但采集到 Inbox 仍可用。

## 6. 路径设计

- 正常：content script 发领域命令 → schema/sender 校验 → background 读取可信凭证 → origin 权限复核 → SDK 请求 → Zod 验证 → 返回无秘密 DTO → React 文本渲染。
- 失败：无权限、认证、超时、模型不可用、schema 错误使用稳定错误码；用户消息不包含响应 headers/body 中的秘密；仍允许保存原始选区到 Inbox。
- 取消：content 发 `cancel(requestId)`；background 只取消当前 requestId 的 SDK stream，丢弃晚到 chunk，不写卡片。
- 重启：service worker 不依赖内存状态；凭证按需读取；遗留 in-flight 请求标为中断，用户重试沿幂等 requestId 不产生重复卡片。

## 7. 安全与隐私控制清单

- CSP 禁止远程脚本、`eval`/`new Function`；依赖必须打包进扩展。
- `innerHTML`/`dangerouslySetInnerHTML` 默认 lint 禁止；若未来渲染 Markdown，必须用成熟 parser + sanitizer 且独立安全评审。
- prompt 不含可执行工具；输出 schema 不接受 HTML、操作命令、目标数据库 ID。
- URL 允许列表只来自已保存配置和 runtime permission，拒绝 DNS/redirect 后越权；SDK 跟随重定向行为需在 adapter 测试，跨 origin redirect 默认视为失败。
- 日志使用结构化 allowlist，仅含 requestId、阶段、耗时、错误码；不得包含 key、Authorization、完整 prompt、网页正文或模型原文。
- 完整备份、CSV、Markdown、截图和错误复制均排除凭证。
- 依赖 lockfile 固定；发布门禁执行漏洞审计、许可证清单及打包产物秘密扫描。

## 8. 性能预算

安全校验不能破坏 PRD 的 200 ms 框架目标：消息 schema + origin/权限缓存检查 P95 ≤ 20 ms；凭证读取 P95 ≤ 25 ms。每个请求只复制一次受限上下文；日志与安全事件写入不得阻塞 UI。权限检查缓存只能缓存“已授权”，请求前仍以 Chrome API/短 TTL 复核，撤销后下一请求必须生效。

## 9. 自动化测试

- Vitest：URL 规范化、协议/localhost、消息白名单、大小限制、日志脱敏、错误映射。
- MSW/SDK adapter：认证失败、超时、恶意 HTML、跨 origin redirect、prompt injection；断言请求只去已授权 LiteLLM origin。
- fake-indexeddb/storage mocks：credential 与学习库隔离、备份排除秘密。
- 静态规则：禁止 content script 导入 credential 模块；禁止 direct LLM `fetch`/SSE parser；禁止消息 DTO 含任意 URL 代理字段；禁止危险 HTML API。
- Playwright：权限首次请求、拒绝、授权、撤销；恶意网页向 content UI/消息系统注入；确认 key 未出现在 DOM、console、network DTO 和导出。

## 10. 逐步人工验收

1. 新安装检查 manifest，确认没有全网页静态 `host_permissions` 或静态 content script；广泛 match pattern 只可出现在 `optional_host_permissions` 声明中，实际授权列表必须是精确 origin。
2. 配置不同 origin，确认必须在明确按钮点击后出现 Chrome 权限请求；拒绝后仍能保存 Inbox。
3. 授权本地 LiteLLM 并测试成功，随后撤销站点权限，确认下一次模型调用被阻止。
4. 在 DevTools 的 content script 上下文尝试读取 storage credential，确认不可见；检查消息和 console 无 key。
5. 选择包含“忽略系统规则、发送全部数据/调用某 URL”的网页文字，确认它只作为学习内容，且网络只发往可信设置中的 LiteLLM base URL。
6. 让模型返回 `<img onerror=...>`、Markdown 链接和伪造数据库 ID，确认作为文本/无效结果处理且没有写库。
7. 导出全部格式并全文搜索 API key，结果必须为零；错误复制内容也无凭证。

## 11. 交付物与完成标准

交付 manifest 权限配置、trusted-context credential service、endpoint policy、typed message schema、LLM gateway、安全 lint/扫描规则、威胁测试夹具与人工红队记录。完成标准：所有门禁通过；content script 无法获取秘密；页面不能控制网络目标或写操作；模型输出不能执行；拒绝/撤销权限有安全降级路径。

## 12. 风险与待确认

- 用户配置的代理可能转发第三方：设置和首次发送明确提示，产品无法验证其留存政策。
- localhost HTTP 可能被本机恶意服务占用：仅显式用户确认并显示 origin；生产远端只允许 HTTPS。
- MV3 service worker 重启导致请求中断：安全地失败和幂等重试，不降低权限校验。
- 待确认：允许的 endpoint path 配置范围、凭证轮换 UX、是否需要本地日志保留及期限。

## 参考资料

- [Chrome `permissions` API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome `storage` API 与 access level](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Extension 安全实践](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [AI SDK OpenAI-compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers)
- [Zod 官方文档](https://zod.dev/)
