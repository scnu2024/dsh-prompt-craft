# prompt-craft 实现契约（Host ↔ Client 冻结版）

本文件是两个半边共同遵守的接口。改动这里必须先改代码再同步本文。

## 归属

| 文件 | 负责人 |
|---|---|
| `index.js`、`lib/*.js`、`test/{protocol,gate,prompt,prefs,route}.test.mjs` | Lead |
| `client.js`、`test/client.test.mjs` | Client 半边 |

任何人不要改对方的文件。

---

## 1. 路由

两条路由都挂在 `ctx.connection.fetch` 上，浏览器用同源 `fetch`，继承 Harness 鉴权。

### `POST /api/prompt-craft/enhance`

请求：

```json
{
  "sessionId": "session-…",
  "draft": "用户输入框里的文本（附件已由客户端替换为 [附件N: name]）",
  "attachments": [{ "index": 1, "name": "slides.pdf", "kind": "file" }],
  "answers": [{ "q": "目标文件是哪个？", "a": "report.md" }],
  "revise": { "id": "clear", "text": "上一版文本", "instruction": "shorter" }
}
```

- `sessionId`、`attachments`、`answers`、`revise` 都可省略。
- `answers` 存在时，宿主把它们当作「用户已确认的事实」拼进请求。
- `revise` 只对指定版本做微调，`instruction` 取值 `"shorter" | "specific"`，返回单个候选。

成功（200）：

```json
{
  "ok": true,
  "questions": [{ "q": "…", "why": "…", "options": ["…"] }],
  "candidates": [
    { "id": "clear", "label": "标准", "text": "…", "warnings": ["invented:2"] }
  ],
  "meta": {
    "provider": "deepseek-account",
    "model": "deepseek-flash",
    "elapsedMs": 4200,
    "context": true,
    "repaired": false
  }
}
```

- `questions` 最多 2 条，可能为空数组。
- `candidates` 正常只有 1 条；`revise` 模式同样只有 1 条。
- `warnings` 是给卡片角标用的稳定代码，见 §5。

失败（400/500/503，同一形状）：

```json
{ "ok": false, "code": "LLM_UNAVAILABLE", "message": "当前环境没有可用模型，草稿未改动。" }
```

客户端**必须原样显示 `message`**，不要自己编错误文案。

### `GET /api/prompt-craft/settings`

```json
{
  "ok": true,
  "values": { "preferences": "", "context": true, "showDiff": true, "provider": "", "model": "" },
  "catalog": {
    "providers": [
      { "id": "deepseek-account", "name": "DeepSeek", "models": [{ "id": "deepseek-flash", "name": "DeepSeek V4.1 Flash" }] }
    ]
  }
}
```

`provider`/`model` 都为空 = 跟随当前会话模型。`catalog` 读取失败时是 `{ "providers": [] }`，页面要给出「读取失败，仍可跟随会话模型」而不是空白下拉。

### `POST /api/prompt-craft/settings`

请求体是 `values` 的任意子集。成功返回 `{ "ok": true, "values": {...完整值} }`，失败同 §1 的失败形状。

---

## 2. 客户端模块形状

`client.js` 是单文件浏览器模块，无构建、无依赖，只能 `require('react')`：

```js
window.__ModuleLoader__.load({
  id: 'dsh-prompt-craft',
  factory(require) {
    const React = require('react')
    // ...
    return { inject: ['slots', 'locale'], apply }
  },
})
```

- 不 import 任何 `@deepseek-ai/*` 包，不读别的插件 DOM，不往 `document.body` 追加东西，不用 JSX。
- `apply(ctx)` 里用 `ctx.effect` 注册样式（一次性 `<style>`，类名前缀 `pc-`）与三处 slot。
- 文案全部走 locale，中英各一份，不得硬编码中文在组件里。
- 为了可测，把纯函数挂到 `apply.__internals = { planInsertion, diffTokens, buildEnhanceBody, ratioOf }`。

---

## 3. 槽位

| 槽位 | id | order | 组件 |
|---|---|---|---|
| `conversation.input.right` | `prompt-craft` | `-100` | `CraftButton` |
| `shell.overlay` | `prompt-craft-panel` | `2` | `CraftPanel`（浮层，锚定在输入框上方，不占布局流） |
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

---

## 4. 状态机（按 session 存）

```js
{
  phase: 'idle' | 'running' | 'ready' | 'error',
  controller: AbortController | null,
  originRaw: '点击那一刻输入框里的原始文本（含 chip 占位符）',
  originModel: '发给宿主的文本（chip 已换成 [附件N: name]）',
  originRev: 0,
  questions: [],
  answers: {},           // q -> a
  candidates: [],
  meta: null,
  error: null,           // 宿主给的 message
  applied: null,         // { text, at }
}
```

规则：

- 只有 `phase === 'running'` 时按钮显示动画；再点一次 = `controller.abort()`，回到 `idle`，草稿不动。
- 生成期间切换会话不取消：任务挂在 map 上，切回来仍能看到结果并应用。
- 应用成功后 `phase: 'ready'`、`applied` 有值、面板折叠成一行摘要（`打磨完成 · 2 版` + 展开 + 关闭），按钮显示 ✓。
- 若 `useInput(draft) !== 应用后的文本` 且用户改动过，保留结果但把「用这版」变成「草稿已改，重新生成」。
- 任何异常都只落到 `error`，不 throw 到渲染层（渲染抛错会把 slot 打空）。

---

## 5. warnings 代码（宿主产出，客户端只负责显示）

| code | 角标文案（zh） |
|---|---|
| `invented:N` | 有 N 处草稿里没有的细节，请核对 |
| `template` | 这版被检测为模板化，已重写但仍不理想 |
| `bloat` | 这版偏长 |
| `placeholder` | 这版含占位符 |
| `repaired` | 已自动重写一次 |

角标不是错误：卡片照常可应用。

---

## 6. 应用到输入框

```js
inputActions.insertText(text, { start, end, draftRev })  // → boolean
inputActions.captureInsertion()                          // → { draftRev, … } | null
```

要求：

1. **没有附件时**：一次 `insertText(text, { start: 0, end: 原文长度, draftRev })`。`原文长度` 用当时读到的 `originRaw.length`。
2. **有附件 chip 时**：不能整段替换（会把 chip 吃掉）。`planInsertion(originRaw, occurrences)` 返回按升序排列的纯文本片段 `[{ start, end }]`；**从后往前**逐个替换，只有最后一段写入新文本，其余写成空串，chip 原样保留。
3. 每次替换前用 `captureInsertion()` 取实时 `draftRev`；`insertText` 返回 `false` → 重试一次，仍失败 → 面板提示「输入框没有接受替换，草稿不变」。
4. 写入前把新文本里的 chip 占位符剥掉（`[\uE100-\uE11D\uFFFC]`），避免产生幽灵附件。
5. 应用是普通编辑步骤，`Ctrl+Z` 天然可退回；不额外做撤销栈。

---

## 7. 面板结构（`shell.overlay`，浮在输入框上方）

```
┌ 打磨结果 · DeepSeek V4.1 Flash · 4.2s ───────────── × ┐
│ 需要你补一句（可选，≤2 条）                              │
│  ① 目标文件是哪个？  [____] [选项chip] [选项chip]        │
│  [带着答案重新生成]  [忽略]                              │
│ ┌ 标准 1.3x ───────────────────────── [对比原文] ┐      │
│ │ 文本（新增片段用底色标出）                       │      │
│ │ [用这版] [再短一点] [再具体一点] [复制]           │      │
│ └──────────────────────────────────────────────┘      │

└────────────────────────────────────────────────────────┘
```

- `phase === 'idle'` 时返回 `null`（dock 里永远不要留空壳）。
- `running`：骨架 + 「取消」。
- `error`：`message` + 「重试」+「关闭」。
- 最多 40vh 高，内部滚动；卡片文字区 max-height 12em。
- 文案与按钮全部来自 locale；复制用 `navigator.clipboard.writeText`，失败静默。

---

## 8. 设置页（`settings.section`）

- 标题「提示词打磨」；一行说明：只影响这个按钮，不影响正常发送。
- 「我的偏好」textarea（`maxLength: 2000`），placeholder 给 3 个例子。
- 开关：参考前面的对话（`context`）、高亮改动（`showDiff`）。
- 下拉：用哪个模型 — 默认「跟随当前会话」（value `""`），其余按 `catalog.providers[].models[]` 分组，value 用 `provider:model`（写回时拆成两个字段）。
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

尺寸对齐宿主：圆角 8px、行高 1.5、正文 13px、次要文字 12px、按钮高 26–28px。新增片段底色：

```css
background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
border-radius: 3px;
```

---

## 10. 测试骨架

照 `/Users/ethan/Documents/ME/dsh-plugins/dsh-btop/test/client.test.mjs`：

1. `globalThis.window = { __ModuleLoader__: { load(d) { definition = d } } }`
2. stub React（`createElement`、`useState`、`useEffect`、`useRef`、`useMemo`、`useCallback`）
3. `await import('../client.js')`，`definition.factory(name => React)` 拿到 plugin
4. 假 `ctx`：`{ effect: f => f(), slots: { inject: (k, cb) => cb(), register: (opts, comp) => { registrations.push({opts, comp}); return () => {} } }, locale: { register: (...a) => { dicts.push(a); return () => {} }, bind: () => t } }`
5. 调用 `plugin.apply(ctx)`，断言 3 处注册与中英字典

`node --test test/` 必须全绿；`node --check client.js` 必须通过。

---

## 11. 宿主保证

- 宿主已经做完归一化与检测，客户端**不要**再改候选文本（除了剥 chip 占位符）。
- 宿主可能返回 `warnings: []`；客户端不要自己判断质量。
- 宿主失败时 `message` 已经是给用户看的人话，客户端不要翻译或拼接。
- 宿主不会返回超过 2 条的 `questions`，也不会返回 2 条以上候选（`revise` 除外）。
