# 12 UI、无障碍与性能技术方案

## 文档状态

- 状态：拟实施；所有用户界面的横切规范
- 对应范围：PRD 3.1、5、7、16、17.1、19
- 适用界面：页面触发按钮/解释浮层、侧边栏、Popup、Dashboard、设置与恢复页

## 1. 范围与非目标

定义跨页面设计 token、组件职责、Shadow DOM 隔离、可访问交互、焦点与关闭规则、缩放/窄视口、减少动画、列表性能和可测量预算。

非目标：不重写浏览器原生控件或 React Aria 已覆盖的交互；不追求像素一致而牺牲网页可用性；不允许仅为动画推迟触发/保存；不把模型延迟计入扩展本地渲染预算而掩盖。

## 2. 需求映射

| 产品体验 | 设计落点 | 验证 |
|---|---|---|
| 选区默认只出按钮 | 明确 `idle/trigger/loading/result` 状态 | 未点击无网络、无浮层 |
| 200 ms 内按钮/框架 | WXT ShadowRoot UI 预加载轻壳，异步重内容 | Performance mark |
| 不遮挡选区/越界 | Floating UI `inline`/`flip`/`shift`/`autoUpdate` | 四角、滚动、缩放 |
| 键盘可完成 | React Aria Components + 明确 focus contract | 仅键盘全流程 |
| 关闭行为可预测 | Esc/空白/重选/滚动状态表 | UI 测试与手验 |
| 大列表持续浏览 | 查询分页 + TanStack Virtual（达到阈值启用） | 1 万卡片滚动 |
| 不只靠颜色 | icon + text + accessible description | 灰阶/高对比检查 |

## 3. 关键决策与备选

1. **WXT `createShadowRootUi` 承载页面 UI。** 隔离站点 CSS，并通过宿主锚点连接 Floating UI。备选直接注入页面 DOM 易受样式污染，否决。
2. **定位使用 `@floating-ui/react`。** `inline` 处理多行 selection rect，`offset`、`flip`、`shift`、`size` 和 `autoUpdate` 处理视口变化；不自研几何引擎。
3. **交互原语使用 React Aria Components。** Button、Dialog、Popover、Menu、Tabs、ListBox、Tooltip、表单和 focus management 复用成熟语义；LexiFlow 只实现视觉和领域组合。
4. **状态可见且稳定。** 触发后立即渲染定高/最小高骨架，流式结果按字段槽更新，避免整个浮层跳位。取消不等待模型。
5. **按数据量启用虚拟化。** Dashboard 列表默认分页/游标；渲染窗口超过 100 行时采用 TanStack Virtual。短列表不增加复杂性。
6. **依赖优先。** 定位、focus trap、键盘导航、虚拟列表不手写；例外必须 ADR 并带无障碍/性能对比证据。

## 4. 组件边界

- `PageSelectionAnchor`：仅产生 selection rect/virtual element，不渲染业务。
- `SelectionTrigger`：轻量按钮；出现不发模型请求。
- `ExplanationPopover`：状态框架和领域 action；定位交给 Floating UI。
- `ShadowUiHost`：WXT lifecycle、样式 token、站点禁用和卸载。
- `AppShell`：Dashboard/Popup/Side panel 导航、全局状态播报。
- `PrimitiveAdapter`：对 React Aria 的薄封装，只绑定 token 和统一文案。
- `VirtualizedCollection`：统一列表测量、roving/focus 恢复、空/错误状态。
- `PerformanceTelemetry`：仅本地 performance marks，不上传分析。

组件不得直接访问 Dexie、凭证或 LLM；通过 typed application commands 获取状态。

## 5. UI 与交互契约

页面状态：

```ts
type SelectionUiState =
  | { kind: 'hidden' }
  | { kind: 'trigger'; anchor: VirtualElement }
  | { kind: 'loading'; requestId: string; anchor: VirtualElement }
  | { kind: 'result'; requestId: string; summary: ExplanationView }
  | { kind: 'error'; requestId: string; code: string; canSaveInbox: true };
```

关闭矩阵：Esc 关闭当前最上层并将焦点返回触发元素/合理页面位置；点击页面空白关闭；形成新选区替换旧状态并取消旧请求；滚动时触发按钮可关闭，已打开浮层由 `autoUpdate` 跟随，锚点不可见则关闭；保存完成显示短暂状态后允许继续阅读。

无障碍契约：触发按钮有 `aria-label`；加载/成功/失败使用节制的 live region；Dialog/Popover 有名称；错误同时含文本与 icon；可操作目标最小 24×24 CSS px，主要触控目标建议 44×44；200% 缩放不丢操作；尊重 `prefers-reduced-motion` 和用户字体设置。快捷键冲突时提供设置入口。

## 6. 路径设计

- 正常：稳定选区 → 200 ms 内 trigger → 用户触发 → 200 ms 内 loading shell/focus → 流式/完整结果 → 保存反馈 → 关闭并恢复阅读。
- 失败：错误状态保留选区和“保存 Inbox/重试/关闭”；错误详情不抢焦点，不用 toast 代替可执行状态。
- 取消：取消按钮立刻回到 trigger 或关闭；晚到结果以 requestId 丢弃；focus 不落到已卸载节点。
- 重启：Dashboard 路由和可恢复草稿按领域存储恢复；页面浮层不跨 tab/browser 重启恢复，已确认保存的数据仍在。

## 7. 安全与隐私

Shadow DOM 是样式边界而非安全边界。所有网页和模型内容作为 React 文本节点，禁止危险 HTML；链接必须由本地 provenance 生成并显示实际域名。UI 不呈现 API key，密码输入不提供“复制到错误详情”。本地性能记录只含组件名、耗时和数量，不含选区文本/URL。

## 8. 性能预算与测量

- 选区稳定至 trigger 可见：P95 ≤ 200 ms。
- 明确触发至 popover shell 可见：P95 ≤ 200 ms。
- 选区处理每次主线程工作：P95 ≤ 16 ms；selectionchange 防抖但不超过 120 ms。
- Popup 首次可交互：P95 ≤ 500 ms；Dashboard shell ≤ 1 s（普通开发机、暖缓存）。
- 10,000 卡片列表滚动：平均 ≥ 55 fps、单次 long task < 100 ms；DOM 行数受虚拟窗口限制。
- content script 初始 JS/CSS gzip 预算 150 KiB；重型 Dashboard/导入功能拆 chunk，不随每页注入。
- 累积布局偏移：浮层内部 CLS 接近 0；骨架到结果不改变外壳宽度，字段变化可局部展开。

使用 `performance.mark/measure` 和 Playwright trace 产生本地 JSON 报告；CI 对相对回退和硬阈值共同门禁。

## 9. 自动化测试

- Vitest：关闭矩阵、状态 reducer、虚拟列表阈值、性能预算计算。
- Testing Library + `@testing-library/user-event`：Tab/Shift+Tab/Esc、可访问名称、live region、focus return、减少动画。
- axe（通过成熟测试集成）作为自动扫描，不能替代键盘/读屏人工验收。
- Playwright：真实 unpacked extension 在普通页面、CSS 污染页、四角选区、多行选区、滚动容器、200% 缩放、窄视口、高对比/减少动画下截图与交互。
- 性能场景：1 万卡片、1 万 Inbox、慢模型/取消；保存和关闭不得等待模型。

## 10. 逐步人工验收

1. 打开普通网页和一个全局 CSS 激进页面，选中单行/多行文字，确认只出现按钮且样式一致。
2. 用鼠标在视口四角、滚动容器内触发，确认按钮/浮层不遮选区、不越界；滚动、重选和空白点击符合关闭矩阵。
3. 全程只用键盘完成触发、展开、保存 Inbox、重试和关闭；焦点顺序可预测且 Esc 返回合理位置。
4. 打开 200% 缩放、320 CSS px 宽视口、系统高对比和减少动画，确认没有不可达操作或仅靠颜色的状态。
5. 注入慢模型和错误，确认 200 ms 内框架出现、可取消、保存/关闭不等待。
6. 载入 1 万卡片数据，持续滚动、筛选和打开详情，记录 trace 并核对预算。
7. 用 VoiceOver 至少验证按钮名称、Popover/Dialog 标题、状态播报和错误操作。

## 11. 交付物与完成标准

交付 token、React Aria primitive adapters、WXT ShadowRoot host、Floating UI 定位、关闭/focus contract、虚拟列表、性能 marks、a11y/E2E fixtures 与人工验收记录。完成标准：关键旅程键盘可达；性能硬预算满足；恶意网页 CSS 不破坏 UI；没有自研定位/focus trap/虚拟化基础设施。

## 12. 风险与待确认

- 浏览器/网页 selection 行为差异：用 fixture 矩阵验证并提供安全关闭/仅选区降级。
- Shadow DOM 与读屏组合差异：保留真实 VoiceOver 验收，不只依赖 axe。
- 虚拟列表焦点丢失：滚动前保存稳定 itemId，返回后恢复到可见项目。
- 待确认：字号档位、动画强度、列表虚拟化实际阈值、站点滚动时浮层是跟随还是关闭的最终偏好。

## 参考资料

- [WXT Shadow Root UI](https://wxt.dev/guide/essentials/content-scripts.html#shadow-root-ui)
- [Floating UI `useFloating`](https://floating-ui.com/docs/usefloating)
- [Floating UI `inline`](https://floating-ui.com/docs/inline)
- [React Aria Components](https://react-spectrum.adobe.com/react-aria/components.html)
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

