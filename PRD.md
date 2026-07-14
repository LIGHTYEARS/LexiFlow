# Chrome 插件 PRD：个人英语阅读采集与 FSRS 复习系统

## 1. 产品概述

### 1.1 产品名称

暂定名：**LexiFlow**

### 1.2 产品定位

LexiFlow 是一个面向个人使用的 Chrome 插件，用于在英文网页阅读过程中，通过划词、划短语、划句子的方式，快速采集陌生单词、常用表达、佳句和技术术语，并将其整理成结构化卡片，形成可检索、可编辑、可复习的个人英语表达知识库。

系统基于本地 LiteLLM endpoint 调用大模型，对选中内容进行解释、去重、合并、分类、整理和练习生成，并基于 FSRS 算法安排长期复习。

### 1.3 目标用户

产品仅面向个人使用，主要用户为：

* 经常阅读英文网页、技术文档、博客、论文、产品文档的用户
* 希望积累英文单词、短语、佳句和技术表达的用户
* 希望通过间隔重复系统长期记忆和复用英语表达的用户
* 偏好本地化、可控、可配置工具链的用户

### 1.4 核心目标

* 降低阅读过程中采集英语材料的操作成本
* 将零散划词行为转化为结构化知识卡片
* 自动识别重复、变体、近义表达和可合并上下文
* 支持单词、短语、句子、技术术语等多类型内容沉淀
* 基于 FSRS 安排复习
* 基于历史错误生成专项练习
* 支持 Inbox 批量整理和半自动知识库维护
* 所有数据默认保存在本地

---

## 2. 产品范围

### 2.1 必须包含的核心能力

* 页面划词浮层
* 当前页面上下文提取
* 调用本地 LiteLLM endpoint
* 单词、短语、句子、技术术语识别
* 中英文解释生成
* 常见表达、例句、近义词、反义词生成
* 相似卡片检索
* 重复卡片判断
* 新建卡片或追加上下文决策
* Inbox 机制
* 批量整理 Inbox
* 卡片知识库管理
* FSRS 复习调度
* 历史错误记录
* 专项练习生成
* 设置页
* 本地数据存储
* 数据导出与备份

### 2.2 暂不作为首版核心目标

以下能力可以预留，但不作为首版必须完成项：

* 多设备云同步
* 对外发布到 Chrome Web Store
* 多用户账户系统
* 移动端支持
* 完整 PDF 阅读器
* OCR
* 自动全文扫描
* Anki APKG 直接生成

---

## 3. 核心使用流程

### 3.1 划词采集流程

```text
用户在网页中选中文本
  ↓
插件显示划词浮层
  ↓
浮层展示快速解释
  ↓
用户点击保存或展开
  ↓
系统提取上下文
  ↓
系统检索相似卡片
  ↓
系统判断操作类型
  ↓
生成操作计划
  ↓
根据规则自动执行或等待用户确认
  ↓
保存到 Inbox 或正式卡片库
  ↓
初始化或更新 FSRS 状态
```

### 3.2 保存时的决策流程

系统保存选中内容时，需要判断：

* 是否已经存在完全重复卡片
* 是否是已有卡片的词形变化
* 是否是已有表达的变体
* 是否应追加为已有卡片的新上下文
* 是否应新增一个独立卡片
* 是否应新增为已有卡片的一个新义项
* 是否应与已有卡片建立关联
* 是否内容价值过低，应建议丢弃

输出结果必须是结构化操作计划。

### 3.3 复习流程

```text
用户打开插件 Popup 或 Dashboard
  ↓
进入今日复习
  ↓
系统读取 FSRS 到期卡片
  ↓
按复习模式展示题目
  ↓
用户作答或自测
  ↓
系统显示答案
  ↓
用户选择 Again / Hard / Good / Easy
  ↓
系统更新 FSRS 状态
  ↓
记录复习日志和错误类型
```

### 3.4 Inbox 批量整理流程

```text
用户进入 Inbox
  ↓
点击批量整理
  ↓
系统读取待整理条目
  ↓
检索相似卡片
  ↓
生成批量操作建议
  ↓
用户逐条或批量确认
  ↓
系统执行新建、合并、追加、打标签、丢弃等操作
```

### 3.5 专项练习生成流程

```text
用户进入专项练习
  ↓
系统读取历史错误记录
  ↓
系统识别薄弱点
  ↓
生成练习题
  ↓
用户完成练习
  ↓
系统记录表现
  ↓
必要时更新相关卡片的复习状态或错误标签
```

---

## 4. 信息架构

### 4.1 Chrome 插件入口

插件包含以下入口：

* 页面划词浮层
* 页面侧边栏
* 插件 Popup
* Dashboard 管理页
* 复习页
* 设置页

### 4.2 页面划词浮层

用于在阅读时快速查看解释和保存内容。

#### 默认展示内容

* 选中文本
* 类型判断
* 中文简义
* 英文简义
* 是否已存在相似卡片
* 操作按钮

#### 操作按钮

* 保存
* 展开
* 编辑
* 改类型
* 忽略
* 查看已有卡片

### 4.3 页面侧边栏

用于查看当前页面中已采集的内容。

#### 主要模块

* 当前页面标题
* 当前页面 URL
* 本页已保存单词
* 本页已保存短语
* 本页已保存句子
* 本页已保存技术术语
* 本页待确认项目
* 本页学习摘要

### 4.4 插件 Popup

用于快速入口和状态概览。

#### 展示内容

* 今日待复习数量
* 逾期卡片数量
* Inbox 待整理数量
* 本周新增数量
* 快捷操作入口

#### 操作入口

* 开始复习
* 打开 Inbox
* 打开词库
* 打开设置
* 当前页面采集记录

### 4.5 Dashboard

Dashboard 是完整管理页。

#### 一级导航

* 今日复习
* Inbox
* 全部卡片
* 页面来源
* 标签
* 错误记录
* 专项练习
* 统计
* 设置

---

## 5. 卡片类型

### 5.1 Word Card：单词卡

用于保存单个单词。

#### 字段

```ts
type WordCard = {
  id: string
  type: 'word'
  text: string
  normalizedText: string
  lemma?: string
  pronunciation?: string
  partOfSpeech: string[]
  meanings: Array<{
    meaningEN: string
    meaningZH: string
    usageNote?: string
  }>
  commonUsages: string[]
  examples: Example[]
  synonyms: string[]
  antonyms: string[]
  contexts: SourceContext[]
  tags: string[]
  relations: CardRelation[]
  reviewState: ReviewState
  metadata: CardMetadata
}
```

### 5.2 Phrase Card：短语 / 表达卡

用于保存短语、固定搭配、惯用表达。

#### 字段

```ts
type PhraseCard = {
  id: string
  type: 'phrase'
  text: string
  normalizedText: string
  meaningEN: string
  meaningZH: string
  usageScenarios: string[]
  commonPatterns: string[]
  examples: Example[]
  alternatives: string[]
  oppositeExpressions: string[]
  contexts: SourceContext[]
  register?: 'casual' | 'neutral' | 'formal' | 'academic' | 'technical'
  tags: string[]
  relations: CardRelation[]
  reviewState: ReviewState
  metadata: CardMetadata
}
```

### 5.3 Sentence Card：佳句卡

用于保存完整句子、可仿写句式和写作素材。

#### 字段

```ts
type SentenceCard = {
  id: string
  type: 'sentence'
  text: string
  normalizedText: string
  translationZH: string
  whyGood: string
  usefulPatterns: string[]
  imitationExamples: Example[]
  rewriteExamples: Example[]
  contexts: SourceContext[]
  tags: string[]
  relations: CardRelation[]
  reviewState: ReviewState
  metadata: CardMetadata
}
```

### 5.4 Technical Term Card：技术术语卡

用于保存技术文档、论文或工程文章中的术语。

#### 字段

```ts
type TechnicalTermCard = {
  id: string
  type: 'technical_term'
  text: string
  normalizedText: string
  domain: string[]
  explanationEN: string
  explanationZH: string
  relatedConcepts: string[]
  commonConfusions: string[]
  examples: Example[]
  contexts: SourceContext[]
  tags: string[]
  relations: CardRelation[]
  reviewState: ReviewState
  metadata: CardMetadata
}
```

---

## 6. 公共数据结构

### 6.1 Example

```ts
type Example = {
  en: string
  zh?: string
  note?: string
  source?: 'llm' | 'user' | 'source_context'
}
```

### 6.2 SourceContext

```ts
type SourceContext = {
  id: string
  text: string
  selectedText: string
  sourceUrl?: string
  sourceTitle?: string
  domain?: string
  capturedAt: string
  note?: string
}
```

### 6.3 CardRelation

```ts
type CardRelation = {
  targetCardId: string
  relationType:
    | 'variant_of'
    | 'synonym_of'
    | 'antonym_of'
    | 'confused_with'
    | 'derived_from'
    | 'same_family'
    | 'used_in_pattern'
    | 'related_to'
  note?: string
}
```

### 6.4 ReviewState

```ts
type ReviewState = {
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  lastReview?: string
}
```

### 6.5 CardMetadata

```ts
type CardMetadata = {
  createdAt: string
  updatedAt: string
  createdFrom: 'selection' | 'inbox' | 'manual' | 'batch'
  sourceUrl?: string
  sourceTitle?: string
  promptVersion?: string
  schemaVersion: number
  model?: string
  confidence?: number
  status: 'inbox' | 'active' | 'suspended' | 'archived' | 'mastered'
}
```

---

## 7. Inbox 设计

### 7.1 Inbox 定位

Inbox 是采集内容进入正式卡片库之前的缓冲区。

用途：

* 存放待确认内容
* 存放低置信度内容
* 存放需要合并判断的内容
* 存放批量采集内容
* 支持批量整理和批量确认

### 7.2 Inbox Item 字段

```ts
type InboxItem = {
  id: string
  selectedText: string
  normalizedText: string
  detectedType?: CardType
  surroundingText?: string
  sourceUrl?: string
  sourceTitle?: string
  llmDraft?: CardDraft
  candidateMatches?: CandidateCard[]
  suggestedActions?: OperationAction[]
  status:
    | 'pending'
    | 'needs_dedupe'
    | 'needs_edit'
    | 'ready_to_create'
    | 'ready_to_merge'
    | 'discard_suggested'
    | 'processed'
  confidence?: number
  createdAt: string
  updatedAt: string
}
```

### 7.3 Inbox 操作

* 新建卡片
* 合并到已有卡片
* 追加上下文
* 新增义项
* 添加标签
* 暂停
* 丢弃
* 批量确认
* 批量重新分析

### 7.4 Inbox 批量整理

批量整理每次默认处理 10-30 条。

系统需要输出：

* 建议操作
* 目标卡片
* 置信度
* 操作理由
* 风险提示

用户可以：

* 单条确认
* 批量确认安全操作
* 修改建议
* 重新生成建议
* 丢弃建议

---

## 8. 去重与相似卡片判断

### 8.1 检索策略

保存内容前，系统必须进行相似卡片检索。

检索方式包括：

* 完全匹配
* 规范化文本匹配
* 词形还原匹配
* 短语 canonical form 匹配
* 模糊文本匹配
* embedding 相似度匹配
* 标签和领域匹配
* 历史上下文匹配

### 8.2 相似关系类型

系统需要判断候选卡片与当前选中内容的关系：

```ts
type SimilarityRelation =
  | 'exact_duplicate'
  | 'inflection_variant'
  | 'same_phrase_new_context'
  | 'same_word_new_sense'
  | 'same_word_same_sense'
  | 'related_expression'
  | 'synonym_but_distinct_usage'
  | 'antonym'
  | 'confusable'
  | 'unrelated'
```

### 8.3 决策结果

系统需要在以下动作中选择：

* 跳过重复
* 追加上下文
* 追加例句
* 新增义项
* 新建卡片
* 建立关联
* 进入 Inbox 等待确认
* 建议丢弃

---

## 9. 操作计划

### 9.1 OperationPlan

所有自动判断结果必须输出为操作计划。

```ts
type OperationPlan = {
  id: string
  source: 'selection' | 'inbox_batch' | 'review_analysis' | 'manual'
  confidence: number
  summary: string
  actions: OperationAction[]
  warnings?: string[]
  createdAt: string
}
```

### 9.2 OperationAction

```ts
type OperationAction =
  | CreateCardAction
  | AppendContextAction
  | AddSenseAction
  | MergeCardsAction
  | LinkCardsAction
  | UpdateTagsAction
  | SuspendCardAction
  | DiscardInboxItemAction
  | GeneratePracticeAction
```

### 9.3 CreateCardAction

```ts
type CreateCardAction = {
  type: 'create_card'
  confidence: number
  cardDraft: CardDraft
  destination: 'inbox' | 'active'
  reason: string
}
```

### 9.4 AppendContextAction

```ts
type AppendContextAction = {
  type: 'append_context'
  confidence: number
  targetCardId: string
  context: SourceContext
  reason: string
}
```

### 9.5 MergeCardsAction

```ts
type MergeCardsAction = {
  type: 'merge_cards'
  confidence: number
  sourceCardIds: string[]
  targetCardId: string
  mergeStrategy: 'append_examples' | 'merge_senses' | 'merge_contexts' | 'manual_review'
  reason: string
}
```

### 9.6 LinkCardsAction

```ts
type LinkCardsAction = {
  type: 'link_cards'
  confidence: number
  sourceCardId: string
  targetCardId: string
  relationType: CardRelation['relationType']
  reason: string
}
```

---

## 10. 自动执行策略

### 10.1 执行模式

```ts
type ExecutionMode =
  | 'dry_run'
  | 'require_confirmation'
  | 'auto_apply_safe_actions'
```

### 10.2 可自动执行操作

以下操作允许自动执行：

* 完全重复内容跳过
* 高置信度追加上下文
* 高置信度追加例句
* 高置信度同一短语变体合并为上下文
* 新建低风险卡片进入 Inbox
* 自动添加低风险标签

### 10.3 必须确认操作

以下操作必须由用户确认：

* 合并两张已有正式卡片
* 删除或丢弃 Inbox 项
* 修改已有卡片核心解释
* 修改已有卡片类型
* 批量更新标签
* 暂停或归档卡片
* 将 Inbox 批量转为正式卡片

### 10.4 禁止自动执行操作

以下操作不允许自动执行：

* 删除正式卡片
* 大规模批量修改正式卡片
* 覆盖用户手写笔记
* 清空复习记录
* 重置 FSRS 状态

### 10.5 默认自动执行规则

```ts
const autoApplyRules = {
  skipExactDuplicate: true,

  appendContextToSameCanonicalPhrase: {
    enabled: true,
    minConfidence: 0.9,
  },

  addExampleToExistingCard: {
    enabled: true,
    minConfidence: 0.85,
  },

  createNewCardToInbox: {
    enabled: true,
    minConfidence: 0.75,
  },

  mergeTwoExistingCards: {
    enabled: false,
  },

  deleteOrDiscard: {
    enabled: false,
  },

  rewriteExistingDefinition: {
    enabled: false,
  },
}
```

---

## 11. 划词浮层需求

### 11.1 触发条件

当用户在网页中选中文本时，插件显示浮层。

触发条件：

* 选中文本长度大于 0
* 选中文本不超过最大长度限制
* 当前站点未被禁用
* 当前页面允许内容脚本运行

### 11.2 浮层位置

浮层应显示在选中文本附近。

位置要求：

* 不遮挡选中内容
* 不超出视口
* 支持滚动页面
* 支持关闭
* 支持快捷键操作

### 11.3 浮层首屏内容

首屏展示：

* 选中文本
* 自动识别类型
* 中文简义
* 英文简义
* 相似卡片状态
* 保存按钮
* 展开按钮
* 忽略按钮

### 11.4 展开内容

展开后展示：

* 完整解释
* 常见搭配
* 例句
* 近义词
* 反义词
* 来源句子
* 相似卡片
* 推荐操作
* 编辑入口
* 保存入口

### 11.5 保存状态

保存后浮层展示：

* 已新建卡片
* 已加入 Inbox
* 已追加到已有卡片
* 已跳过重复
* 需要确认
* 生成失败

---

## 12. Dashboard 需求

### 12.1 全部卡片页

功能：

* 卡片列表
* 卡片详情
* 搜索
* 筛选
* 编辑
* 删除
* 暂停
* 归档
* 标签管理
* 关系查看
* 复习状态查看

筛选条件：

* 卡片类型
* 标签
* 来源网站
* 创建时间
* 更新时间
* 复习状态
* 是否到期
* 是否逾期
* 难度
* 错误次数

### 12.2 卡片详情页

展示：

* 卡片正文
* 中英文解释
* 例句
* 上下文
* 标签
* 关联卡片
* 来源页面
* 复习状态
* 复习历史
* 错误历史
* 编辑记录

操作：

* 编辑字段
* 追加例句
* 追加上下文
* 添加关系
* 重新生成解释
* 暂停复习
* 恢复复习
* 删除卡片

### 12.3 页面来源页

按来源页面聚合展示卡片。

字段：

* 页面标题
* 页面 URL
* 域名
* 采集时间
* 卡片数量
* 单词数量
* 短语数量
* 句子数量
* 技术术语数量

### 12.4 标签页

功能：

* 查看所有标签
* 新建标签
* 重命名标签
* 删除标签
* 合并标签
* 查看标签下卡片
* 批量打标签

### 12.5 统计页

展示：

* 总卡片数
* 今日新增
* 本周新增
* 今日复习
* 逾期卡片
* 连续复习天数
* 各类型卡片占比
* 各标签卡片占比
* 遗忘率
* Again 次数分布
* 高频错误表达
* 最难卡片列表

---

## 13. FSRS 复习需求

### 13.1 评分

复习后用户选择四档评分：

```text
Again / Hard / Good / Easy
```

中文显示：

```text
完全忘了 / 困难 / 想起来了 / 很简单
```

### 13.2 卡片状态

```ts
type FSRSState =
  | 'new'
  | 'learning'
  | 'review'
  | 'relearning'
```

### 13.3 今日复习列表

排序优先级：

1. 逾期卡片
2. 到期复习卡片
3. 学习中卡片
4. 新卡片

### 13.4 复习模式

系统支持以下复习模式：

#### 快速复习

用户看正面，自测后显示答案。

适用于：

* 单词
* 短语
* 技术术语

#### 输入复习

用户输入中文解释、英文解释或例句。

适用于：

* 短语
* 佳句
* 技术术语

#### 完形填空

隐藏目标单词或表达。

适用于：

* 短语
* 句子
* 技术术语

#### 仿写练习

用户基于句型进行仿写。

适用于：

* 佳句
* 表达卡

#### 区分练习

让用户区分相似表达。

适用于：

* 近义词
* 易混短语
* 技术术语

### 13.5 复习设置

用户可配置：

* 每日新卡上限
* 每日复习上限
* 默认新卡开始复习时间
* 是否允许逾期堆积
* 是否优先复习困难卡
* 是否启用专项练习
* 默认复习模式

---

## 14. 历史错误记录

### 14.1 ReviewLog

每次复习需要记录 ReviewLog。

```ts
type ReviewLog = {
  id: string
  cardId: string
  rating: 'again' | 'hard' | 'good' | 'easy'
  reviewedAt: string
  userAnswer?: string
  expectedAnswer?: string
  mistakeType?:
    | 'forgot_meaning'
    | 'recognized_but_cannot_use'
    | 'wrong_collocation'
    | 'confused_with_similar'
    | 'wrong_register'
    | 'wrong_context'
  selfNote?: string
  responseTimeMs?: number
}
```

### 14.2 错误类型

用户可以手动选择错误类型，也可以由系统建议。

错误类型包括：

* 忘记含义
* 认识但不会用
* 搭配错误
* 和相似表达混淆
* 语体错误
* 语境错误

### 14.3 错误页

错误页展示：

* 最近错误
* 高频错误卡片
* 高频混淆关系
* 按标签筛选错误
* 按类型筛选错误
* 生成专项练习入口

---

## 15. 专项练习需求

### 15.1 练习来源

专项练习基于：

* 历史错误记录
* Again / Hard 评分
* 混淆关系
* 困难卡片
* 高频复习失败标签
* 用户手动选择的卡片集合

### 15.2 练习类型

支持：

* 中译英
* 英译中
* 完形填空
* 选择题
* 近义表达区分
* 仿写题
* 技术术语解释
* 错题回放

### 15.3 PracticeSession

```ts
type PracticeSession = {
  id: string
  title: string
  focus: string
  sourceCardIds: string[]
  items: PracticeItem[]
  createdAt: string
  completedAt?: string
}
```

### 15.4 PracticeItem

```ts
type PracticeItem = {
  id: string
  type:
    | 'translation_zh_to_en'
    | 'translation_en_to_zh'
    | 'cloze'
    | 'multiple_choice'
    | 'distinguish_similar'
    | 'imitation'
    | 'technical_explanation'
  question: string
  answer: string
  explanation?: string
  choices?: string[]
  sourceCardIds: string[]
}
```

---

## 16. 设置需求

### 16.1 LiteLLM 设置

用户可配置：

* Endpoint URL
* API Key
* Model
* Temperature
* Timeout
* Max tokens
* Streaming 开关
* 重试次数

默认 endpoint 示例：

```text
http://localhost:4000/v1
```

### 16.2 模型配置

支持为不同任务配置不同模型：

* 快速解释模型
* 完整分析模型
* 批量整理模型
* 专项练习模型
* embedding 模型

### 16.3 Prompt 配置

支持编辑以下 prompt：

* 快速解释 prompt
* 选区处理 prompt
* 卡片去重 prompt
* Inbox 整理 prompt
* 专项练习 prompt
* 标签生成 prompt
* 佳句分析 prompt
* 技术术语分析 prompt

每个 prompt 需要版本号。

### 16.4 自动执行配置

用户可配置：

* 自动跳过完全重复
* 自动追加上下文
* 自动创建 Inbox 条目
* 自动添加标签
* 自动合并阈值
* 是否所有操作都要求确认

### 16.5 复习配置

用户可配置：

* 每日复习上限
* 每日新卡上限
* 新卡默认进入时间
* 复习提醒时间
* 是否启用专项练习
* FSRS 参数

### 16.6 数据配置

用户可操作：

* 导出 JSON
* 导入 JSON
* 导出 CSV
* 导出 Markdown
* 手动备份
* 恢复备份
* 清空 Inbox
* 清空所有数据
* 重建搜索索引
* 重建 embedding 索引

---

## 17. 本地存储需求

### 17.1 存储方案

首选：

```text
IndexedDB + Dexie
```

### 17.2 数据表

需要包含：

* cards
* inboxItems
* reviewLogs
* practiceSessions
* sources
* tags
* settings
* operationPlans
* embeddings
* migrations

### 17.3 数据迁移

系统必须支持数据库 migration。

要求：

* 每个 schema 有版本号
* 每次升级可自动迁移
* 迁移失败需要保留旧数据
* 支持导出备份后再迁移

---

## 18. 搜索需求

### 18.1 普通搜索

支持搜索：

* 卡片文本
* 解释
* 例句
* 标签
* 来源页面
* 用户笔记

### 18.2 高级筛选

支持：

```text
type:phrase
tag:frontend
source:react.dev
due:today
status:inbox
difficulty:hard
created:this_week
```

### 18.3 相似搜索

用于：

* 保存时去重
* Inbox 整理
* 卡片合并建议
* 近义表达练习
* 混淆表达练习

---

## 19. 技术架构

### 19.1 推荐技术栈

```text
Extension Framework: WXT
UI: React
Language: TypeScript
Build: Vite
State: Zustand
DB: IndexedDB + Dexie
Schema: Zod
AI SDK: Vercel AI SDK Core
LLM Gateway: LiteLLM OpenAI-compatible endpoint
FSRS: ts-fsrs
Messaging: chrome.runtime.sendMessage / chrome.runtime.connect
```

### 19.2 目录结构

```text
src/
  extension/
    background/
      index.ts
      message-router.ts
    content/
      selection-capture.ts
      popover.ts
      context-extractor.ts
    popup/
    sidepanel/
    dashboard/

  ai/
    agent-service.ts
    agent-runtime.ts
    tools/
      search-similar-cards.tool.ts
      get-card-detail.tool.ts
      search-review-mistakes.tool.ts
      search-inbox-items.tool.ts
    schemas/
      operation-plan.schema.ts
      card.schema.ts
      practice.schema.ts
    prompts/
      selection-agent.prompt.ts
      inbox-organizer.prompt.ts
      weakness-practice.prompt.ts

  domain/
    cards/
      card.types.ts
      card-normalizer.ts
      card-repository.ts
      card-search-service.ts
      card-merge-service.ts
    inbox/
      inbox-repository.ts
      inbox-organizer.ts
    review/
      fsrs-service.ts
      review-log-repository.ts
      weakness-analyzer.ts
    sources/
      source-repository.ts

  db/
    dexie.ts
    migrations.ts

  settings/
    settings-service.ts

  shared/
    types.ts
    constants.ts
```

### 19.3 通信结构

```text
Content Script
  ↓
Background Service Worker
  ↓
AgentService / Repository / FSRS
  ↓
IndexedDB / LiteLLM
```

要求：

* Content Script 不直接访问 LiteLLM
* LLM 调用统一由 Background Service Worker 处理
* Dashboard、Popup、Sidepanel 通过 message 或 port 与 Background 通信
* 数据写入统一走 repository 层

---

## 20. AI Agent 与 Tool 设计

### 20.1 AgentService

```ts
export interface AgentService {
  processSelection(input: ProcessSelectionInput): Promise<SelectionOperationPlan>

  organizeInbox(input: OrganizeInboxInput): Promise<InboxOperationPlan>

  generateWeaknessPractice(
    input: GenerateWeaknessPracticeInput,
  ): Promise<PracticeSessionDraft>

  suggestCardMerge(input: SuggestCardMergeInput): Promise<MergeSuggestion>
}
```

### 20.2 允许直接调用的工具

```text
searchSimilarCards
getCardDetail
searchReviewMistakes
searchInboxItems
getPageContext
searchCardsByTag
```

### 20.3 不允许直接调用的写操作

以下操作不能直接暴露给模型执行：

```text
createCard
updateCard
mergeCards
deleteCard
deleteInboxItem
scheduleReview
recordReview
clearData
```

这些操作必须由 OperationExecutor 执行。

### 20.4 OperationExecutor

```ts
export interface OperationExecutor {
  execute(plan: OperationPlan, mode: ExecutionMode): Promise<ExecutionResult>
}
```

### 20.5 PolicyEngine

```ts
export interface PolicyEngine {
  canAutoApply(action: OperationAction): boolean
  requiresConfirmation(action: OperationAction): boolean
  validate(plan: OperationPlan): ValidationResult
}
```

---

## 21. 页面上下文提取

### 21.1 提取内容

划词时需要提取：

* selectedText
* selectedText 前后文
* 当前段落
* 当前标题
* 页面标题
* 页面 URL
* 页面域名
* 选区 DOM 路径
* 语言判断

### 21.2 上下文长度

默认提取：

* 选中文本前 300-500 字符
* 选中文本后 300-500 字符
* 所在段落全文
* 页面标题

### 21.3 特殊页面

对于以下页面需要兼容：

* 普通文章网页
* 技术文档
* GitHub
* MDN
* React docs
* Next.js docs
* Medium
* Substack
* PDF viewer 页面可暂不支持深度解析

---

## 22. 导出与备份

### 22.1 导出格式

必须支持：

* JSON
* CSV
* Markdown

### 22.2 JSON 导出

JSON 导出必须包含：

* cards
* inboxItems
* reviewLogs
* practiceSessions
* tags
* sources
* settings
* schemaVersion

### 22.3 Markdown 导出

Markdown 按卡片类型组织：

```text
# Word Cards
# Phrase Cards
# Sentence Cards
# Technical Terms
```

### 22.4 备份策略

支持：

* 手动备份
* 定期提醒备份
* 导入前自动备份
* migration 前自动备份

---

## 23. 快捷键

### 23.1 默认快捷键

```text
Alt + L：打开划词浮层
Alt + S：保存当前选区
Alt + E：展开解释
Alt + I：加入 Inbox
Alt + R：开始复习
Esc：关闭浮层
```

快捷键需要支持用户自定义。

---

## 24. 状态与错误处理

### 24.1 LLM 请求状态

状态包括：

* idle
* loading
* streaming
* success
* error
* timeout
* cancelled

### 24.2 错误类型

需要处理：

* LiteLLM endpoint 不可用
* API key 错误
* 请求超时
* 模型返回格式错误
* JSON schema 校验失败
* IndexedDB 写入失败
* Chrome 权限不足
* 当前页面不支持内容脚本

### 24.3 错误反馈

浮层错误提示需要简短：

```text
生成失败，可重试
无法连接本地模型
保存失败，请检查本地数据库
当前页面不支持划词
```

Dashboard 中可以展示详细错误。

---

## 25. 非功能需求

### 25.1 性能

* 划词浮层应在 200ms 内出现
* 快速解释目标在 1-3 秒内返回
* 保存动作不能阻塞页面滚动和阅读
* Dashboard 卡片列表需要支持分页或虚拟列表
* Inbox 批量整理需要分批处理

### 25.2 隐私

* 默认所有数据保存在本地
* 默认只请求用户配置的本地 LiteLLM endpoint
* 不向第三方服务发送数据，除非用户主动配置
* API key 存储在本地扩展配置中
* 导出文件由用户手动保存

### 25.3 可维护性

* Prompt 需要版本化
* Card schema 需要版本化
* DB migration 需要版本化
* Agent 输出必须 schema 校验
* 所有写操作必须经过 repository 层
* 所有自动操作必须经过 PolicyEngine

### 25.4 可恢复性

* 支持导出备份
* 支持导入恢复
* 支持 migration 前自动备份
* 关键批量操作需要保留 OperationPlan 记录
* 支持撤销最近一次批量操作

---

## 26. 首版交付范围

### 26.1 P0

必须完成：

* Chrome 插件基础结构
* 页面划词浮层
* LiteLLM 设置
* 调用本地 LiteLLM endpoint
* 单词 / 短语 / 句子 / 技术术语识别
* 结构化解释生成
* IndexedDB 存储
* 卡片模型
* Inbox 模型
* 相似卡片检索
* OperationPlan
* PolicyEngine
* 新建卡片
* 追加上下文
* 跳过重复
* Dashboard 卡片管理
* FSRS 复习
* ReviewLog
* JSON 导出

### 26.2 P1

首版增强：

* Inbox 批量整理
* 历史错误页
* 专项练习生成
* 卡片关系
* 高级搜索
* 标签管理
* Markdown / CSV 导出
* Prompt 设置
* 自动执行规则设置

### 26.3 P2

后续增强：

* embedding 搜索优化
* 当前页面学习摘要
* 自动页面扫描
* Anki 导出
* 数据同步
* PDF 支持
* 更丰富统计页

---

## 27. 验收标准

### 27.1 划词采集

* 用户选中英文单词后，浮层能正常出现
* 浮层能展示中英文解释
* 用户点击保存后，系统能判断是否已有相似卡片
* 已有相同卡片时，不重复创建
* 词形变化能追加到已有卡片上下文
* 新内容能进入 Inbox 或正式卡片库

### 27.2 卡片管理

* 用户能查看所有卡片
* 用户能按类型、标签、来源筛选卡片
* 用户能编辑卡片内容
* 用户能查看卡片来源上下文
* 用户能查看卡片复习状态
* 用户能删除、暂停、归档卡片

### 27.3 Inbox

* 用户能查看待整理项目
* 系统能为 Inbox 条目生成整理建议
* 用户能确认新建、合并、追加、丢弃操作
* 批量操作前有确认
* 批量操作后有结果反馈

### 27.4 FSRS 复习

* 系统能展示今日到期卡片
* 用户能完成复习并评分
* 系统能更新 FSRS 状态
* 系统能记录 ReviewLog
* Again / Hard 卡片能进入错误记录

### 27.5 专项练习

* 系统能读取历史错误
* 系统能生成至少一种专项练习
* 用户完成练习后能记录结果
* 专项练习能关联原始卡片

### 27.6 数据导出

* 用户能导出 JSON
* 导出的 JSON 能包含全部核心数据
* 用户能重新导入 JSON
* 导入后卡片和复习记录可用

---

## 28. 风险与约束

### 28.1 技术风险

* Chrome Extension Service Worker 生命周期可能影响长任务
* LiteLLM endpoint 不稳定会影响解释生成
* 本地模型结构化输出质量可能不稳定
* IndexedDB 数据结构升级需要谨慎
* 大量卡片后相似搜索性能可能下降

### 28.2 产品风险

* 自动生成内容可能过多，造成 Inbox 堆积
* 自动合并错误可能污染知识库
* 复习压力过大可能降低长期使用率
* 标签体系过细可能增加维护成本

### 28.3 缓解策略

* 所有写操作经过 PolicyEngine
* 高风险操作必须确认
* Inbox 作为缓冲区
* 支持撤销批量操作
* 支持导出备份
* 支持暂停卡片
* 支持每日新卡和复习上限

---

## 29. 默认配置

### 29.1 LiteLLM

```json
{
  "endpoint": "http://localhost:4000/v1",
  "model": "",
  "temperature": 0.2,
  "timeoutMs": 15000,
  "maxRetries": 1,
  "streaming": true
}
```

### 29.2 复习

```json
{
  "dailyNewLimit": 20,
  "dailyReviewLimit": 100,
  "newCardStart": "tomorrow",
  "prioritizeOverdue": true,
  "enableWeaknessPractice": true
}
```

### 29.3 自动执行

```json
{
  "skipExactDuplicate": true,
  "autoAppendContext": true,
  "autoAppendContextMinConfidence": 0.9,
  "autoCreateCardToInbox": true,
  "autoCreateCardMinConfidence": 0.75,
  "autoMergeExistingCards": false,
  "autoDiscardInboxItems": false,
  "autoRewriteDefinitions": false
}
```

### 29.4 卡片

```json
{
  "defaultNewCardDestination": "inbox",
  "enableCardRelations": true,
  "enableSourceContext": true,
  "enablePromptVersionTracking": true
}
```

---

## 30. 成功标准

产品完成后，应满足以下结果：

* 阅读英文网页时，可以通过划词快速采集学习材料
* 保存内容不会大量重复
* 系统能正确处理词形变化和表达变体
* 系统能将新上下文追加到已有卡片
* 用户可以批量整理 Inbox
* 用户可以通过 FSRS 持续复习
* 系统能基于历史错误生成专项练习
* 所有卡片、复习记录、错误记录都可以本地管理和导出
* 产品可以长期作为个人英语表达知识库使用

