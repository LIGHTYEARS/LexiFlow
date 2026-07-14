# 13 测试、发布与升级门禁技术方案

## 文档状态

- 状态：拟实施；P0/P1 交付的最终裁决文档
- 对应范围：PRD 17、19、20 及全部高风险不变量
- 发布对象：本地 unpacked extension 与可归档 zip；当前不发布 Chrome Web Store

## 1. 范围与非目标

定义测试分层、fixtures、确定性模型替身、静态安全规则、数据库迁移验证、性能/无障碍预算、一条命令式验收、制品追溯和回滚条件。

非目标：不以测试覆盖率替代产品验收；不在 CI 调用真实付费/私有模型；不把“构建成功”视为数据可恢复；不绕过人工权限、安全、备份和读屏检查。

## 2. 需求与门禁映射

| 不变量 | 自动门禁 | 人工门禁 |
|---|---|---|
| 选区默认不请求模型 | Playwright 网络断言 | 普通网页触发检查 |
| 重试不重复保存 | integration + fake-indexeddb | 连续重试查看计数 |
| 默认专项练习不改 FSRS | DB snapshot diff | 完成练习前后对比 |
| 高风险操作需确认 | UI contract tests | 合并/删除/清空流程 |
| 完整备份可恢复 | 新 profile round trip | 真实文件恢复演练 |
| 凭证/网络边界安全 | 静态扫描 + malicious fixtures | 权限撤销、导出搜密钥 |
| 可访问/性能预算 | Testing Library/axe/trace | 键盘、VoiceOver、200% |
| 升级失败可恢复 | migration fixtures + fault injection | 上一版本数据升级演练 |

## 3. 关键决策与备选

1. **测试金字塔。** Vitest 测纯领域逻辑；Testing Library 测用户可见组件；MSW 测统一 SDK adapter 的网络边界；fake-indexeddb 测事务/迁移；Playwright 加载真实 unpacked extension 测关键闭环。备选全部依赖 E2E 速度慢且难定位，否决。
2. **模型测试不匹配自然语言全文。** 使用固定结构 fixture，断言 schema、不变量、provenance 和失败降级；少量人工样本验证可用性。
3. **一条命令可复现。** `pnpm release:verify` 必须从干净依赖状态依次执行 lint/typecheck/static gates/unit/integration/build/E2E/artifact manifest，并输出报告与两个制品。
4. **静态门禁是阻断项。** 必须扫描并拒绝：direct/raw `fetch` 调用 LLM endpoint、手写 SSE parser；content script 读取 credentials；页面消息携带可控 URL/method/headers 形成代理；危险 HTML；未批准的成熟能力自研。例外只接受仓库 ADR 白名单且有到期复审日期。
5. **发布以可恢复性优先。** schema 变更没有旧版 fixture、升级前备份和失败回滚测试，不得发布。

## 4. 测试与发布组件边界

- `tests/unit`：领域函数、Zod schema、策略和 reducer。
- `tests/integration`：Dexie repositories、消息、SDK adapter、备份/恢复。
- `tests/components`：React Aria 组合、焦点、状态反馈。
- `tests/e2e`：Playwright persistent Chromium context 加载 unpacked extension。
- `tests/fixtures`：网页、模型响应、数据库版本、备份损坏样本；不得含真实凭证/私人网页。
- `scripts/static-gates`：AST/依赖规则；不用易误报的纯字符串 grep 作为唯一判断。
- `scripts/release-verify`：只编排标准工具，不复制测试 runner。
- `artifacts/`：测试报告、unpacked、zip、manifest/checksums/SBOM；不提交生成物到源码，除非发布流程另定。

## 5. 命令与制品契约

唯一发布验证入口：

```bash
pnpm release:verify
```

成功时必须产生：

```text
artifacts/<version>/
├── reports/
│   ├── test-results.json
│   ├── playwright-report/
│   ├── accessibility.json
│   ├── performance.json
│   └── static-gates.json
├── lexiflow-<version>-unpacked/
├── lexiflow-<version>.zip
├── artifact-manifest.json
├── SHA256SUMS
└── sbom.cdx.json
```

`artifact-manifest.json` 至少含 git commit、脏工作区状态、Node/pnpm/Chrome/Playwright 版本、lockfile hash、manifest permissions、数据库 schema 版本、测试摘要和制品 SHA-256。任一步失败命令非零退出，删除/标记不完整 zip，绝不能留下看似可发布的成功制品。

## 6. 正常、失败、取消与重启路径

- 正常：锁定依赖 → 静态/类型/测试 → build unpacked → 扫描 manifest/CSP/秘密 → Playwright → zip → checksum/SBOM → 报告成功。
- 失败：保留诊断报告与 trace，标记 `releaseStatus: failed`；不生成最终 zip 或将其移至 `invalid/`。修复后必须完整重跑，禁止只手工重跑最后一步。
- 取消：捕获信号，终止子进程，写明 cancelled，并清理部分制品；缓存可保留但不能成为报告证据。
- 重启：命令默认重新执行全部阻断门禁；不得从未知中间状态“继续发布”。只有独立的开发测试命令可增量。

## 7. 安全与隐私门禁

静态门禁至少包括：

- LLM host 只在统一 AI SDK gateway 配置；业务代码不得 raw `fetch` LLM URL，也不得包含 EventSource/SSE 行解析器。
- content script 依赖图不得到达 `CredentialService`/secret storage；storage access level 必须设为 `TRUSTED_CONTEXTS`。
- typed message schema 禁止页面提供 `url/path/method/headers/apiKey/fetchOptions` 网络控制字段。
- manifest 不含全网页静态 `host_permissions` 或静态 content script；广泛 match pattern 仅允许出现在 `optional_host_permissions` 声明中，运行时授予和动态脚本注册必须限定精确 origin；CSP 无远程脚本/eval。
- 输出渲染无 `dangerouslySetInnerHTML`/未批准 sanitizer 路径；打包产物执行 secret pattern 与 source map 审查。
- 完整备份、CSV、Markdown fixture 的秘密搜索为零。
- dependency audit、许可证/SBOM 和 lockfile 漂移检查通过。

门禁允许的网络原语例外（例如 MSW 测试或非 LLM、无官方 SDK 的简单请求）必须限定目录，并由 ADR 列出能力调研、安全边界、替换条件和复审日期。

## 8. 性能与稳定性门禁

- 使用文档 12 的硬预算；Playwright trace 生成机器可读报告。
- 性能基线固定 fixture、浏览器版本和运行轮次；取中位数/P95，单次噪声不直接失败但硬阈值始终阻断。
- flaky 测试不可静默重跑至通过；报告首次失败和重试，连续两次 flaky 即阻断发布并建问题。
- 覆盖率初始门槛：领域/安全策略语句与分支 ≥ 90%，全仓语句 ≥ 80%；关键不变量以 mutation/negative test 强化，不用覆盖率证明正确。
- E2E 必测：采集/失败入 Inbox、重复保存、今日复习、默认专项练习、完整恢复、权限撤销、升级回滚。

## 9. 升级与回滚协议

每次 Dexie schema 版本必须有：`vN-1` 及仍支持版本 fixture、预期迁移摘要、幂等测试、故障注入点和升级前保护备份。升级流程为：检测旧版本 → 保护备份 → staging/事务迁移 → 不变量校验 → 切换 → 标记完成。失败保持旧库或从保护备份恢复，禁止带部分迁移数据继续运行。

应用回滚不得假设旧代码能读新 schema；artifact manifest 声明 `minReadableSchema/maxReadableSchema`。若不兼容，只能通过备份恢复流程降级，并明确可能丢失新版本后创建的数据。

## 10. 自动化测试矩阵

- Vitest：全部领域不变量、URL/权限/脱敏、FSRS adapter、导入 manifest。
- Testing Library：主要操作的角色/名称、键盘、焦点、取消和错误恢复。
- MSW：SDK 成功/流式/超时/认证/畸形结构/恶意输出；不访问真实模型。
- fake-indexeddb：事务、migration、重启、恢复、幂等。
- Playwright：真实扩展 service worker/content script/Popup/Side panel/Dashboard，使用本地测试页与 mock LiteLLM。
- 人工：真实 Chrome 权限 UI、VoiceOver、真实 LiteLLM 连接、备份文件灾难恢复。

## 11. 逐步人工发布验收

1. 在干净 checkout 执行 `pnpm install --frozen-lockfile` 与 `pnpm release:verify`，确认单命令非零/零状态正确。
2. 打开报告，核对 commit、浏览器、schema、权限、测试数量和所有 SHA-256；从 unpacked 目录加载扩展。
3. 在普通与恶意 fixture 页面完成“选区只出按钮 → 触发 → 失败入 Inbox → 重试不重复”。
4. 完成复习和专项练习，验证后者默认不改 FSRS；重启后历史仍在。
5. 导出完整备份，在新 profile 恢复；搜索制品/备份/console，确认无凭证。
6. 从上一发布版本数据升级并在故障点中断，确认回滚；再正常升级验证关联和计数。
7. 仅键盘及 VoiceOver 完成关键流程，核对 200% 缩放和性能报告。
8. 从 zip 解压并与 unpacked 文件清单/hash 对比；任何差异阻断签发。

## 12. 交付物与完成标准

交付统一脚本、工具配置、测试分层、fixtures、静态 AST 门禁、Playwright extension fixture、迁移矩阵、报告 schema、unpacked/zip/checksum/SBOM 生成器和人工签发表。完成标准是 `pnpm release:verify` 一次产生完整报告及可核验双制品，全部阻断项通过，人工签发者能只凭本文复现结论。

## 13. 风险与待确认

- Playwright 对 Chrome 扩展支持依赖 bundled Chromium：发布前另做一次目标 Chrome 人工 smoke test。
- 本地 CI 环境性能波动：固定环境和硬阈值，保留 trace；不取消性能门禁。
- 依赖审计误报/供应链变化：风险接受必须 ADR、范围、到期日，不永久忽略。
- 待确认：CI 平台、最低支持 Chrome 版本、制品签名方式、覆盖率初始基线和发布保留策略。

## 参考资料

- [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- [Chrome 扩展端到端测试](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Vitest 官方文档](https://vitest.dev/)
- [Mock Service Worker](https://mswjs.io/docs/)
- [Testing Library 指导原则](https://testing-library.com/docs/guiding-principles/)
- [CycloneDX SBOM](https://cyclonedx.org/docs/)
