# prompt-craft v2 实现契约

Host 和 Client 同步使用此协议。生产保持零运行时依赖，不生成底层任务答案，不发送会话消息。历史生产实现与评测报告位于 eval，冻结基线不随重构修改。

## 1. 路由

通过宿主已鉴权的 connection.fetch 注册，不添加外部服务。

### POST /api/prompt-craft/enhance

```json
{
  "protocolVersion": 2,
  "sessionId": "session-id",
  "draft": "原始需求",
  "attachments": [{"index": 1, "name": "report.md", "kind": "file"}],
  "images": [{"index": 2, "name": "screen.png", "mediaType": "image/png", "data": "canonical base64"}],
  "language": "zh",
  "answers": [{"q": "目标文件？", "a": "report.md"}],
  "revise": {"id": "clear", "text": "当前有效版本", "instruction": "specific"},
  "clarificationMode": "ask",
  "revisionContext": {
    "versions": [{"text": "历史有效版本", "operation": "enhance"}],
    "improvements": ["已完成的改进摘要"]
  }
}
```

除 protocolVersion、draft 外均可省略。协议不匹配返回 HTTP 409、CLIENT_OUTDATED 和刷新提示。先验证空草稿和草稿长度。revise.instruction 为 shorter 或 specific；历史 operation 还允许 enhance。

确认回答累计传递，最多 64 条，每条 q 最多 240 字、a 最多 500 字；超额明确报错，不静默移除旧条目。历史只保留最后三版和最近 24 条改进摘要，仅供比较，不能授权新事实。文字字段受 256 KiB 上限约束，带图片的整个请求受 28 MiB 上限约束，实际读取累计字节检查，不信任声明长度。

clarificationMode 默认 ask；proceed 只在用户主动按已有信息继续时发送，只对本轮生效。proceed 不授权编造缺失值。普通文件只贡献名称，宿主不读取正文。

images 最多 8 张，单张解码后 10 MiB，总计 20 MiB；编号为唯一正整数，对应当前草稿附件顺序。同名图片保留为不同编号。支持 PNG、JPEG、WebP、GIF，整批检查 canonical Base64 和大小后交给 `attachments.saveImages()` 校验像素并保存，转成 `{type:'image',attachment:ref}` 内容块。仅图片时允许 draft 为空，缺少任务目标先追问。language 只用于无文字草稿的回复语言，默认为 zh。

每次 `prepareCall` 后检查 `inputModalities` 包含 image，能力未知或不支持时返回 IMAGE_MODEL_REQUIRED。图片请求中所选模型失效不会改投其他模型。错误文案不携带图片字节、供应方原始消息或宿主图片路径。

响应：

```json
{
  "ok": true,
  "protocolVersion": 2,
  "status": "ready",
  "reason": "本轮处理原因",
  "questions": [],
  "candidates": [{"id": "clear", "label": "标准", "text": "完整提示词", "warnings": [], "details": []}],
  "changes": [{"id": "i1", "summary": "本轮实际改进"}],
  "meta": {
    "provider": "provider-id", "model": "model-id", "elapsedMs": 4000,
    "attempts": 2, "repaired": false, "context": true,
    "contextTruncated": false, "answersUsed": 1, "imagesUsed": 1,
    "unchanged": false, "specificExhausted": false
  }
}
```

- needs_input：最多两个关键问题，候选为空，不调用生成阶段。
- ready：一个完整、经过校验的新候选，附实际改进摘要。
- unchanged：保留当前版本，附具体原因。specific 请求设置 specificExhausted，客户端暂停该按钮。
- blocked：质量修复后仍不合格，无新候选，附 code: QUALITY_BLOCKED 和 violations；客户端保留已有版本并显示原因。

网络、取消、超时、损坏结构化输出等使用失败信封：`{ok:false,code,message}`。客户端原样显示 message。没有新候选不能统一归类为模型失败。

### GET /api/prompt-craft/settings

响应 `{ok:true,values,catalog,limits,capabilities}`。values 保留 preferences、context、showDiff、provider、model。limits 包含 timeoutMs、maxDraftChars。capabilities 包含 draftImages:true 和 imageLimits；客户端发图前必须确认能力标志，旧 Host 明确提示刷新升级。`?catalog=0` 不查询模型目录；完整目录有超时和按上下文隔离的缓存。

### POST /api/prompt-craft/settings

接收 values 的任意子集，返回完整设置。偏好最长 2000 字；设置文件路径和格式兼容 v1。

## 2. 客户端模块形状

`client.js` 是单文件浏览器模块，无构建、无第三方依赖，只 `require('react')`，另有一次受控的 `require('react-dom')`（宿主已提供，用来把面板 portal 到 `document.body`，拿不到时退回元素内渲染）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-prompt-craft',
  factory(require) {
    const React = require('react')
    // ...
    return { inject: ['slots', 'locale', 'conversation'], apply }
  },
})
```

- 不 import 任何 `@deepseek-ai/*` 包，不读别的插件 DOM，不用 JSX。
- 宿主 DOM 只有两处受控触点：`react-dom` 的 `createPortal(…, document.body)`（把面板移出 composer 的包含块），以及只读地量取「自己按钮的祖先里带 `data-composer-card` 标记的那张卡片」的 `getBoundingClientRect()`；不查询其他插件或宿主节点；焦点约束仅遍历插件自身面板 ref 的后代，并读取 `document.activeElement`。
- `apply(ctx)` 里用 `ctx.effect` 注册样式（一次性 `<style>`，类名前缀 `pc-`）与三处 slot。
- 文案全部走 locale，中英各一份，不得硬编码中文在组件里。
- 为了可测，把辅助函数挂到 `apply.__internals = { planInsertion, diffTokens, buildEnhanceBody, ratioOf, composerBoxOf, portalToBody, panelGeometry, prepareDraftImages }`。

---

## 3. 槽位

| 槽位 | id | order | 组件 |
|---|---|---|---|
| `conversation.input.right` | `prompt-craft` | `-100` | `CraftButton` |
| `conversation.input.overlay` | `prompt-craft-panel` | `2` | `CraftPanel`（新会话与已有会话共用 overlay；渲染时 portal 到 body，用 fixed 锚定在输入框卡片上方；无 `react-dom` 时在 overlay 顶部用 absolute 定位） |
| `settings.section` | `prompt-craft` | `50` | `CraftSettings`（`label: () => t('nav')`） |

注册写法：

```js
ctx.slots.inject('conversation.input.right', () =>
  ctx.slots.register({ name: 'conversation.input.right', id: 'prompt-craft', order: -100 }, CraftButton))
```

槽位给组件的 props（按需取）：`sessionId`、`useInput`、`inputActions`。

- `useInput(selector)` 是快照选择器：`state.draft`、`state.draftRev`、`state.phase`、`state.occurrences`、`state.attachmentIds`。
- `state.occurrences` 是 `[{ offset, length, clipboardText }]`，给出附件 chip 在 **clipboard 坐标** 里的位置；`draft` 本身是带 `\uFFFC` / `\uE100-\uE11D` 占位符的 detect 投影。
- 面板与按钮是同一模块里的两个组件，状态必须共享：模块级 `Map<sessionId, task>` + `subscribe(sessionId, fn)`，不要用 props 传递。
- 面板和按钮各自读取槽位提供的 `sessionId`、`useInput`、`inputActions`；不使用全局当前会话或按钮转发的输入快照。
- 面板每次渲染都调用相同的四个 `useInput` 选择器，包括 idle、关闭、切换会话时；不得按按钮是否挂载来决定 Hook 调用。
- 按钮通过按 `sessionId` 稳定的 callback ref 登记锚点，首次输入后也能登记；面板挂载后补测一次，等兄弟节点的 ref 完成挂载。

---

## 4. 会话状态和迭代

任务生命周期 phase 为 idle、running、ready、error；成功返回后用独立 status 区分 needs_input、ready、unchanged、blocked。等待回答显示“待确认”，不能标为已生成成稿。

每个任务保存原始输入与附件快照、当前有效候选、累计确认回答、尚未提交的填写值、待续的 revise、最近三版文本、改进摘要、停止原因以及 specificExhausted。

客户端读取 `conversation.resolveDraftAttachments(attachmentIds)` 获取原始图片文件，不读其他插件 DOM。草稿图片可独立于 occurrences 存在。图片序列、文件对象身份和草稿修订号在读取前后及响应返回后核对；不匹配则拒绝过期结果。每轮追问和微调重新读取图片。图片字节仅在请求期间使用，savedTask、sessionStorage、响应和日志不保存字节。缓存只保存 hadImages 和附件标识；刷新后的图片若不可获取，保留预览、禁止应用，提示重新添加。

- 提交答案和主动跳过均延续原操作。微调产生的问题显示在面板中，回答后继续同一微调。
- 插件回答只存在于该流程中，生成成稿必须吸收相关确认信息。
- 外部草稿、附件或修订号变化重建流程，丢弃旧答案及迭代记录。成功应用后清理本会话任务和缓存，再次点击打磨从当前输入重新开始。
- 停止具体化后保留补充信息入口；追加信息使用不同问题键，避免覆盖上次补充。
- 运行时保留稳定结果和快照。取消恢复稳定状态；网络失败显示错误并保留结果、待答问题及可重试的确认信息；迟到响应不得覆盖新请求。
- 缓存键 dsh-prompt-craft:results:v2，最多 20 个会话。结果、待答问题和填写值均可恢复，恢复后重新验证草稿。旧 v1 缓存不迁移。

## 5. 分析、生成和校验

先分析原始需求与当前版本，输出 ask、rewrite 或 unchanged 决策及具体改进计划。每个改进点必须包含 gap，说明其避免的具体遗漏或执行错误。只分析短草稿，不使用按任务分类的直接跳过路径。计划和生成版本不属于事实依据。

图片请求的分析增加 `imageObservations:[{index,facts}]`，最多 8 条、每条最多 16 个 300 字的明确可见事实。只接受本轮图片编号，图片猜测和普通 confirmedFacts 不授权新事实。可见证据参与本轮生成和事实检查，不能改变用户目标和明确限制。每个模型调用，包括格式或质量修复，都携带同一批图片；不增加独立识图调用。历史图片不读取。图片证据仍依赖模型识别准确性。

关键信息缺失先问，proceed 模式不得继续提问。问题不能重复已确认的问题，或包含与明确限制冲突的活动。普通篇幅和默认风格选择不应成为追问理由；呈现风格不阻塞一般任务，格式转换和返回值契约等实质选择继续允许提问。已有材料不重复索取。

生成阶段重新组织完整文本，只落实计划内改进。结果包含已实施计划 id 及摘要。每次操作共享三次调用和一个总超时，分析恢复至少为生成预留一次调用；格式、质量和截断恢复共用剩余额度。默认 90 秒。

校验包括新事实、确认事实丢失、限制丢失和冲突、占位符、绝对输出长度、重复句段、近似重复、同方向版本循环、缩短是否实际变短及计划 id。重复比较忽略代码、引用、原有重复和用户明确要求的重复。纯标点变化不算实质进步。

允许与任务相称的标题、步骤和合理扩展，不设置统一长度倍率。语义事实判断仍有启发式边界。

既有 warnings 渲染保留兼容能力；v2 不把未通过质量检查的新候选作为带警告的成功结果。

## 6. 应用到输入框

```js
inputActions.insertText(text, { start, end, draftRev })  // → boolean
inputActions.captureInsertion()                          // → { draftRev, … } | null
```

要求：

1. **没有附件时**：一次 `insertText(text, { start: 0, end: 原文长度, draftRev })`。`原文长度` 用当时读到的 `originRaw.length`。
   只有图片且原文字为空时，同样使用一次范围 `{start:0,end:0}` 的插入，独立图片附件保留。
2. **有附件 chip 时**：不能整段替换（会把 chip 吃掉）。`planInsertion(originRaw, occurrences)` 返回按升序排列的纯文本片段 `[{ start, end }]`；**从后往前**逐个替换，只有最后一段写入新文本，其余写成空串，chip 原样保留。
3. 应用前用 `captureInsertion()` 核对实时修订号；后续片段使用前一步成功后的修订号。任一片段被拒绝就停止；首次拒绝提示草稿不变，部分完成时明确提示撤销和复制，不再强制重试。
4. 写入前把新文本里的 chip 占位符剥掉（`[\uE100-\uE11D\uFFFC]`），避免产生幽灵附件。
5. 应用是普通编辑步骤，可用撤销退回；多段替换可能需要多次撤销。所有替换成功后调用 closeTask，关闭整个面板并删除当前会话的任务、视图状态和结果缓存，不显示已应用摘要条。旧事件重复触发时不再次写入。失败或部分写入时保持面板可见。恢复缓存时丢弃旧版 applied 且 collapsed 的摘要记录，其他未应用结果正常恢复。

---

## 7. 面板结构与阅读模式

- 默认在输入框上方展示，宽度跟随输入框且不超过 860px，高度结合可用空间及 62% 视口高度计算。
- 标题栏、正文区、操作栏采用纵向 flex 布局；只有 `.pc-panel-body` 滚动。正文保持原始字符、换行及缩进，卡片没有独立高度限制。
- 标题栏提供展开阅读及关闭控件。展开模式使用 body portal 和遮罩，宽度最大 960px，高度 84% 可见视口；上方可用空间小于 240px 时默认展开。
- 展开模式约束焦点；Esc 返回浮层，再次 Esc 关闭。生成状态的关闭和取消均恢复已有结果。输入法组合与已处理的键盘事件不拦截。
- 在没有 react-dom 的旧宿主中，继续以内联绝对定位展示，保留阅读与关闭控件，不声明模态对话框。
- 按会话保存内存视图状态：展开阅读、原文对照、候选高亮覆盖和问题折叠。关闭时清理，刷新后重置；视图状态与结果缓存分开管理。
- 原文对照与高亮为独立控件。高亮沿用新增片段算法，默认遵循 `showDiff`。字数按 Unicode 码点计数。
- 固定底栏左侧为微调操作，右侧为复制和应用；窄屏分两行。生成及待答期间禁用微调及应用，仍可复制已有结果。
- 首次生成显示骨架和真实耗时；重新生成从 `fallback` 读取上一版及其原文快照。失败保留可用候选并原样显示宿主错误。
- 补充问题位于结果下方，首次返回默认展开；折叠不清空回答。新响应中的问题重新展开。
- 警告完整显示，details 可展开查看；复制成功后才显示成功反馈。

---

## 8. 设置页（`settings.section`）

- 标题「提示词打磨」；一行说明：只影响这个按钮，不影响正常发送。
- 分为写作偏好、上下文与预览、模型三个分组；偏好 textarea 的 `maxLength: 2000`，显示实时字数计数。
- 开关：参考前面的对话（`context`）、高亮改动（`showDiff`）。
- 下拉：用哪个模型; 默认「跟随当前会话」（value `""`），其余按 `catalog.providers[].models[]` 分组，value 用 `provider:model`（写回时拆成两个字段）。
- `[保存]` + 状态行（读取中 / 已保存 / 保存失败：`message`）。
- 加载失败要能降级：只显示偏好与开关，模型下拉显示「读取失败，仍跟随会话模型」。

---

## 9. 视觉

只用主题变量，禁止写死颜色（图标/加载动画除外）：

```
--dsw-alias-bg-base  --dsw-alias-bg-layer-1  --dsw-alias-bg-layer-2  --dsw-alias-bg-overlay
--dsw-alias-border-l1  --dsw-alias-border-l2
--dsw-alias-label-primary  --dsw-alias-label-secondary
--dsw-alias-brand-primary  --dsw-alias-state-success-primary
--dsw-alias-state-error-primary  --dsw-alias-state-warn-primary
--dsw-alias-state-idle-primary
```

面板及设置分组圆角 14px；正文 14px、行高 1.7，次要文字 12px；入口胶囊高 28px，操作按钮最小高度 32px。渐变、阴影和状态底色通过主题变量及 `color-mix` 派生；遵循 `prefers-reduced-motion`。新增片段底色：

```css
background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
border-radius: 3px;
```

---

## 10. 验证与宿主保证

npm run check、npm test 和 npm run test:ui 必须通过。测试包括短草稿、独立追问、累计答案、微调追问、五轮具体化、停止后补充、刷新、取消、失败及附件编辑。

客户端不重新解释或改写宿主候选，写入前仅移除 chip 占位符。最多一个新候选，最多两个问题。候选缺省时按 status 处理。

## 11. 开发预览和真实模型评测

npm run preview:ui 仅绑定本机，使用真实客户端和模拟 API，不调用模型。

通用评测通过 eval:general:dev、eval:general:accept 显式启动，10 个开发任务和 20 个验收任务分开。覆盖五类任务、完整对照和迭代，冻结输入和源码哈希，保留全部调用、失败、两次顺序交换的语义评审及确定性检查。

技术答案评测继续使用冻结生产基线。候选使用 v2 和显式 proceed，避免把待答状态误当成空成稿；不使用技术策略开关。历史报告保持原样。
