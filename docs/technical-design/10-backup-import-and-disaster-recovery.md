# 10 备份、导入与灾难恢复技术方案

## 文档状态

- 状态：拟实施，P0 发布阻断项
- 对应范围：PRD 3.6、14.5、15、17.2、18.6、19.7、20.1
- 核心约束：完整备份是唯一承诺可恢复的数据格式；CSV 和 Markdown 仅用于阅读/迁移，不是完整备份

## 1. 范围与非目标

覆盖本地 Dexie 数据库的完整导出、预检、恢复、升级前自动保护备份、灾难回滚，以及卡片 CSV/Markdown 导入导出。完整备份必须包含卡片、来源、Inbox、标签关系、复习/错误/练习历史、非敏感设置和操作记录。

非目标：不实现云同步、远程备份服务、Anki APKG、跨用户合并；不承诺 CSV/Markdown 恢复调度历史；不导出 LiteLLM API key、会话 token 或其他秘密。

## 2. 需求映射

| 产品要求 | 方案 | 人工证据 |
|---|---|---|
| 新安装可完整恢复 | `dexie-export-import` 完整 Blob + manifest | 空 profile 恢复后数据计数与关联一致 |
| 导入前预览 | `peakImportFile` + 自有 manifest 校验 | 执行前展示版本、表、数量、冲突策略 |
| 不静默覆盖 | 默认 restore-to-new-db 或显式 replace | 无确认时主库 hash 不变 |
| 导入/升级前备份 | 保护备份写入受控本地文件/Blob 下载流程 | 故障注入后可回滚 |
| CSV/Markdown 迁移 | Papa Parse 处理 CSV；Markdown 只输出可读内容 | 文案明确“不能完整恢复” |
| 部分失败可理解 | 阶段化 job 与错误报告 | 失败阶段、原数据状态和下一步可见 |

## 3. 关键决策与备选

1. **使用 `dexie-export-import`，不自研 IndexedDB dump。** 它提供 Blob 导入导出、元数据预检、chunk、进度和原子选项。备选手写 cursor/JSON 会遗漏 Date、Blob 和事务语义，否决。
2. **恢复采用 staging database。** 文件先导入临时数据库，执行 schema、计数、引用和抽样校验；通过后关闭主库并进行一次明确的替换操作。备选直接 `importInto` 主库风险不可接受。
3. **完整备份与便携导出分轨。** `.lexiflow-backup.json` 保持库结构与 manifest；CSV 由 Papa Parse `unparse/parse`，Markdown 由项目既有 Markdown 序列化依赖生成。二者不得显示为“完整恢复”。
4. **秘密默认不进入任何备份。** 连接配置只保留非敏感的 endpoint、model 和 task mapping；API key 必须重新输入。允许未来做加密秘密备份前需独立 ADR 和密钥恢复设计。
5. **SDK-first/library-first。** 文件解析、CSV 转义、数据库导入导出不得手写；若依赖缺能力，先提交 ADR。

## 4. 组件边界

- `BackupCoordinator`：编排 job 与互斥锁，不理解表字段。
- `DexieBackupAdapter`：唯一调用 `exportDB`、`peakImportFile`、`importDB` 的模块。
- `BackupManifestService`：生成/校验产品版本、schema 版本、创建时间、计数、校验摘要、秘密排除声明。
- `RestoreValidator`：在 staging DB 检查引用完整性、必填字段、日期及 ID 唯一性。
- `DatabaseSwapService`：经确认后替换主库；失败恢复旧库。
- `PortableExportService`：Papa Parse CSV 与 Markdown；禁止写复习状态。
- `RecoveryJournal`：记录阶段，不包含学习正文和凭证。

## 5. 数据与协议契约

完整备份外层：

```ts
type BackupManifest = {
  product: 'LexiFlow';
  formatVersion: 1;
  databaseSchemaVersion: number;
  appVersion: string;
  createdAt: string;
  tableCounts: Record<string, number>;
  excludedSecrets: ['litellmApiKey'];
  payloadSha256: string;
};
```

文件实际 payload 使用 `dexie-export-import` Blob；外层 manifest 与 payload 可装入 zip 容器，但不得修改依赖生成的数据库内容。SHA-256 使用 Web Crypto `crypto.subtle.digest`。导入接受的 URL 永远不存在：只接受用户通过文件选择器明确提供的 `File`/`Blob`，禁止页面或模型传入远程 URL。

CSV 首行固定版本化列名，公式注入防护：以 `=`, `+`, `-`, `@` 开头的文本在导出时按 Papa Parse 的 `escapeFormulae` 规则处理；导入只允许白名单字段，未知字段展示并忽略。任何 CSV 行都不能直接写复习/错误历史。

## 6. 路径设计

- 正常备份：获取只读一致性视图 → 导出 Blob → 计算摘要 → 下载临时文件 → 用户确认文件已生成 → 记录成功时间。
- 正常恢复：选择文件 → manifest/大小/摘要预检 → 展示变化与秘密排除 → 自动创建当前库保护备份 → staging 导入与校验 → 用户最终确认 → 原子切换 → 重开数据库与搜索索引重建。
- 失败：预检失败不创建 staging；staging 失败删除 staging、主库不变；切换失败按 recovery journal 恢复旧库并进入只读故障页。
- 取消：最终确认前可随时取消并清理 staging；切换阶段不可中断，UI 说明短暂等待。
- 重启：启动时读取 recovery journal；`staging` 阶段可清理/继续校验，`swapping` 阶段优先验证主库，无法证明完整则恢复保护备份。

## 7. 安全与隐私

备份是敏感文件，UI 在下载前提示其中包含学习原文、页面 URL 和历史。API key 和其他秘密默认排除，导入完成后显示“需重新输入凭证”。文件名不含卡片内容或域名。错误日志只记录 jobId、阶段和计数。导入严格限制文件大小、格式版本和递归/压缩展开预算，防止资源耗尽；不执行文件中的 HTML、Markdown 或 URL。

## 8. 性能预算

- 10 万条记录、500 MB 上限内使用依赖的 chunk/progress，不一次读入 UI 主线程内存。
- 预检首个可见结果 ≤ 500 ms；长任务每 250 ms–1 s 更新进度。
- UI 主线程单次工作片 ≤ 50 ms；必要时在 Worker 运行导出/校验。
- staging 额外磁盘预算：备份 payload 的 2.2 倍；空间不足在写主库前终止。

## 9. 自动化测试

- Vitest：manifest、版本兼容矩阵、摘要、秘密排除、CSV 白名单与公式注入。
- fake-indexeddb：完整 round trip、staging 校验、事务失败、切换与 recovery journal。
- Testing Library：预览、危险确认、进度、取消和恢复建议。
- 测试 fixture：当前版本、上一版本、未来版本、损坏摘要、孤儿引用、超限文件。
- Playwright：创建学习数据 → 导出 → 新 profile 导入 → 验证卡片/来源/复习/练习历史；验证 API key 为空且需重新输入。

## 10. 逐步人工验收

1. 建立四类卡片、多个来源、Inbox、复习/错误/练习记录和 LiteLLM 凭证。
2. 导出完整备份，确认警告和秘密排除声明，保留文件。
3. 分别导出 CSV/Markdown，确认页面明确标注“非完整备份”，CSV 用电子表格打开无公式执行。
4. 在空 Chrome profile 加载扩展并选择完整备份，确认执行前可见版本、表计数及变化摘要。
5. 完成恢复，核对实体数量、关系、来源、下次复习和历史；确认 API key 未恢复。
6. 在已有数据 profile 导入损坏文件和未来版本文件，确认主库未变化。
7. 在 staging 和 swapping 阶段分别故障注入/重启，确认前者可清理、后者恢复旧库或明确进入只读恢复页。

## 11. 交付物与完成标准

交付 backup/restore adapter、manifest schema、staging/切换与 journal、CSV/Markdown 服务、兼容 fixture、自动化与人工验收报告。完成标准：完整 round trip 的关键表计数和引用一致；失败不损伤原库；秘密不出现在导出内容；CSV/Markdown 从未被承诺为完整恢复。

## 12. 风险与待确认

- 浏览器空间不足：切换前估算并拒绝危险操作。
- 大版本兼容：只支持明确的迁移链，未来版本只读预检后拒绝。
- 用户丢失下载文件：待确认备份提醒频率和保留数量；不未经同意上传云端。
- 待确认：备份压缩容器、最大支持体积、是否允许可选密码加密。

## 参考资料

- [Dexie Export/Import 官方文档](https://dexie.org/docs/ExportImport/dexie-export-import)
- [Papa Parse 官方文档](https://www.papaparse.com/docs)
- [Web Crypto `digest`](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest)

