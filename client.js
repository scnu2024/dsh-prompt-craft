/**
 * Browser half of the prompt-craft plugin.
 *
 * Adds a small "craft the prompt" control to the composer toolbar, a preview
 * dock above the composer where two conservative rewrites can be compared and
 * applied, and a settings section. Nothing is written into the composer until
 * the user clicks apply; the Host half owns normalisation and quality checks.
 *
 * The module is a single plain-JS file loaded by the browser module table:
 * React is the only module it requires, every colour comes from a theme token,
 * and all user-visible copy lives in the locale tables below.
 *
 * Contract: ./CONTRACT.md
 *
 * @module dsh-prompt-craft/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-prompt-craft',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const NS = 'prompt-craft'
    const BUTTON_SLOT = 'conversation.input.right'
    const PANEL_SLOT = 'conversation.composer.dock'
    const SETTINGS_SLOT = 'settings.section'
    const BUTTON_ID = 'prompt-craft'
    const PANEL_ID = 'prompt-craft-panel'
    const SETTINGS_ID = 'prompt-craft'
    const BUTTON_ORDER = -100
    const PANEL_ORDER = 2
    const SETTINGS_ORDER = 50
    const ENHANCE_PATH = '/api/prompt-craft/enhance'
    const SETTINGS_PATH = '/api/prompt-craft/settings'
    const PREFERENCES_MAX = 2000
    const ANSWER_MAX = 300
    const COPY_RESET_MS = 1400
    /** Above this many token pairs the diff falls back to a prefix/suffix scan. */
    const DIFF_PAIR_BUDGET = 250000
    /** Attachment chips occupy one placeholder character in the detect draft. */
    const CHIP_PLACEHOLDER_GLOBAL_RE = /[\uE100-\uE11D\uFFFC]/gu
    const CHIP_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/u
    /**
     * Wire marker the Host documents for attached files: an attachment number
     * and a display name inside square brackets. Escaped on purpose so the only
     * CJK copy in this file is the zh locale table.
     */
    const ATTACHMENT_LABEL = '\u9644\u4ef6'

    // ---------------------------------------------------------------------
    // Locale tables. `prompt-craft` is the namespace used for every lookup.
    // ---------------------------------------------------------------------

    const en = {
      'nav': 'Prompt craft',
      'button.idle': 'Craft the prompt: one clearer version',
      'button.running': 'Crafting the prompt; click to cancel',
      'button.done': 'Crafting finished; click to regenerate',
      'button.failed': 'Crafting failed; click to retry',
      'panel.title': 'Crafted versions',
      'panel.close': 'Close',
      'panel.expand': 'Expand',
      'panel.running': 'Crafting…',
      'panel.cancel': 'Cancel',
      'panel.retry': 'Retry',
      'panel.summary': 'Crafting finished · {count} version(s)',
      'panel.applied': 'Applied to the composer',
      'panel.refused': 'The composer refused the replacement; the draft is unchanged.',
      'panel.staleApply': 'Draft changed; regenerate',
      'panel.elapsed': '{seconds}s',
      'panel.answerPlaceholder': 'Add an answer…',
      'panel.questionsTitle': 'A couple of questions (optional, up to 2)',
      'panel.questionsSubmit': 'Regenerate with the answers',
      'panel.questionsIgnore': 'Ignore',
      'card.apply': 'Use this version',
      'card.compare': 'Compare with draft',
      'card.compareOff': 'Hide comparison',
      'card.shorter': 'Shorter',
      'card.specific': 'More specific',
      'card.copy': 'Copy',
      'card.copied': 'Copied',
      'card.ratio': '{ratio}x',
      'warning.invented': 'Includes {count} detail(s) that are not in your draft — please check',
      'warning.template': 'Detected as templated; rewritten once but still not ideal',
      'warning.bloat': 'Longer than your draft',
      'warning.placeholder': 'Contains placeholders',
      'warning.repaired': 'Auto-rewritten once',
      'warning.unknown': 'Check this version',
      'error.network': 'Cannot reach the local service; check that the plugin is enabled.',
      'error.http': 'Request failed (HTTP {status}).',
      'error.badPayload': 'The Host returned an unrecognised payload.',
      'error.empty': 'The Host returned no candidates; please retry.',
      'settings.intro': 'Only affects the “Craft prompt” button; it never changes what you send.',
      'settings.loading': 'Loading settings…',
      'settings.reading': 'Loading…',
      'settings.saving': 'Saving…',
      'settings.saved': 'Saved',
      'settings.save': 'Save',
      'settings.loadFailed': 'Could not load settings: {message}',
      'settings.saveFailed': 'Could not save: {message}',
      'settings.preferences.title': 'My preferences',
      'settings.preferences.placeholder': 'For example:\n· Meeting notes must paste straight into Notion\n· Code must be TypeScript, never any\n· Lead with the conclusion',
      'settings.context.title': 'Use earlier messages',
      'settings.context.hint': 'When on, crafting reads this conversation’s earlier messages; costs a few more tokens.',
      'settings.showDiff.title': 'Highlight changes',
      'settings.showDiff.hint': 'Marks what is new compared with your draft by default.',
      'settings.model.title': 'Which model',
      'settings.model.follow': 'Follow the current conversation',
      'settings.model.loading': 'Loading available models…',
      'settings.model.loadFailed': 'Could not load models; still following the conversation model',
    }

    const zh = {
      'nav': '提示词打磨',
      'button.idle': '打磨提示词：生成一版更清晰的写法',
      'button.running': '正在打磨提示词，点击可取消',
      'button.done': '打磨完成，点击重新生成',
      'button.failed': '打磨失败，点击重试',
      'panel.title': '打磨结果',
      'panel.close': '关闭',
      'panel.expand': '展开',
      'panel.running': '正在打磨…',
      'panel.cancel': '取消',
      'panel.retry': '重试',
      'panel.summary': '打磨完成 · {count} 版',
      'panel.applied': '已应用到输入框',
      'panel.refused': '输入框没有接受替换，草稿不变。',
      'panel.staleApply': '草稿已改，重新生成',
      'panel.elapsed': '{seconds} 秒',
      'panel.answerPlaceholder': '补充一句…',
      'panel.questionsTitle': '需要你补一句（可选，≤2 条）',
      'panel.questionsSubmit': '带着答案重新生成',
      'panel.questionsIgnore': '忽略',
      'card.apply': '用这版',
      'card.compare': '对比原文',
      'card.compareOff': '收起对比',
      'card.shorter': '再短一点',
      'card.specific': '再具体一点',
      'card.copy': '复制',
      'card.copied': '已复制',
      'card.ratio': '{ratio}x',
      'warning.invented': '有 {count} 处草稿里没有的细节，请核对',
      'warning.template': '这版被检测为模板化，已重写但仍不理想',
      'warning.bloat': '这版偏长',
      'warning.placeholder': '这版含占位符',
      'warning.repaired': '已自动重写一次',
      'warning.unknown': '这版有需要核对的地方',
      'error.network': '无法连接本机服务，请确认插件已启用。',
      'error.http': '请求失败（HTTP {status}）。',
      'error.badPayload': '宿主返回了无法识别的数据。',
      'error.empty': '宿主没有返回候选，请重试。',
      'settings.intro': '只影响「打磨提示词」按钮，不影响正常发送。',
      'settings.loading': '正在读取设置…',
      'settings.reading': '读取中…',
      'settings.saving': '保存中…',
      'settings.saved': '已保存',
      'settings.save': '保存',
      'settings.loadFailed': '读取失败：{message}',
      'settings.saveFailed': '保存失败：{message}',
      'settings.preferences.title': '我的偏好',
      'settings.preferences.placeholder': '例如：\n· 会议纪要要能直接粘进飞书\n· 代码只用 TypeScript，不要 any\n· 先给结论，再给理由',
      'settings.context.title': '参考前面的对话',
      'settings.context.hint': '开启后打磨会参考本会话前文，会多耗一些 token。',
      'settings.showDiff.title': '高亮改动',
      'settings.showDiff.hint': '默认在候选里标出相对原文新增的部分。',
      'settings.model.title': '用哪个模型',
      'settings.model.follow': '跟随当前会话',
      'settings.model.loading': '正在读取可用模型…',
      'settings.model.loadFailed': '读取失败，仍跟随会话模型',
    }

    // ---------------------------------------------------------------------
    // Stylesheet: one <style> element owned by apply(), class prefix `pc-`.
    // Every colour is a --dsw-alias-* token; only icons/spinners use
    // currentColor. No literal colour values appear here.
    // ---------------------------------------------------------------------

    const css = `
.pc-btn-root {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.pc-btn-root:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pc-btn-root:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-btn-root[data-state="running"] { color: var(--dsw-alias-brand-primary); cursor: progress; }
.pc-btn-root[data-state="ready"] { color: var(--dsw-alias-state-success-primary); }
.pc-btn-root[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.pc-spin {
  display: inline-block;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  animation: pc-spin 0.8s linear infinite;
}
.pc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: currentColor; }
.pc-icon { display: block; }
.pc-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 10px 12px 12px;
  max-height: 40vh;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}
.pc-panel-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pc-panel-title { font-weight: 600; white-space: nowrap; }
.pc-panel-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.pc-panel-head .pc-icon-btn { margin-left: auto; }
.pc-icon-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.pc-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.pc-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-skeleton { display: flex; flex-direction: column; gap: 6px; padding: 2px 0; }
.pc-skeleton-bar {
  display: block;
  height: 10px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  animation: pc-breathe 1.4s ease-in-out infinite;
}
.pc-skeleton-bar:nth-child(2) { width: 86%; }
.pc-skeleton-bar:nth-child(3) { width: 64%; }
.pc-panel-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pc-btn {
  box-sizing: border-box;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.pc-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.pc-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-btn:disabled { opacity: 0.55; cursor: default; }
.pc-btn-primary {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.pc-btn-primary:hover { background: var(--dsw-alias-brand-primary); }
.pc-error,
.pc-refused {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.pc-refused { color: var(--dsw-alias-state-warn-primary); }
.pc-applied { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
.pc-questions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
}
.pc-questions-title { margin: 0; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.pc-question { display: flex; flex-direction: column; gap: 4px; }
.pc-question-row { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px; }
.pc-question-row .pc-answer-input { flex: 1 1 200px; min-width: 140px; }
.pc-question-text { font-size: 13px; }
.pc-question-why { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pc-chip {
  box-sizing: border-box;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.pc-chip:hover { background: var(--dsw-alias-bg-layer-2); }
.pc-chip[data-selected="true"] {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.pc-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-answer-input {
  box-sizing: border-box;
  flex: 1;
  min-width: 120px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
.pc-answer-input:focus { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-question-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.pc-cards { display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: 10px; }
.pc-cards > * { flex: 1 1 320px; min-width: 280px; }
.pc-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
}
.pc-card-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.pc-card-label { font-weight: 600; }
.pc-ratio { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.pc-warn {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border: 1px solid var(--dsw-alias-state-warn-primary);
  border-radius: 999px;
  color: var(--dsw-alias-state-warn-primary);
  font-size: 11px;
  line-height: 1.4;
}
.pc-card-text {
  max-height: 12em;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
}
.pc-add {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
  border-radius: 3px;
  color: inherit;
}
.pc-card-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pc-panel-summary { flex-direction: row; align-items: center; gap: 8px; }
.pc-check { color: var(--dsw-alias-state-success-primary); }
.pc-summary-text { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pc-summary-spacer { flex: 1; }
.pc-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}
.pc-settings-title { margin: 0; font-size: 14px; font-weight: 600; }
.pc-settings-intro { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pc-field { display: flex; flex-direction: column; gap: 4px; }
.pc-field-label { font-size: 13px; font-weight: 500; }
.pc-field-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pc-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 76px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}
.pc-textarea:focus { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-toggle { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.pc-toggle-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pc-switch {
  box-sizing: border-box;
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin-top: 2px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
}
.pc-switch[data-on="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
}
.pc-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  transition: left 120ms ease;
}
.pc-switch[data-on="true"] .pc-switch-knob { left: 16px; }
.pc-select {
  box-sizing: border-box;
  height: 28px;
  max-width: 100%;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
.pc-select:focus { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.pc-settings-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pc-status { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pc-status[data-kind="saved"] { color: var(--dsw-alias-state-success-primary); }
.pc-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
@keyframes pc-spin { to { transform: rotate(360deg); } }
@keyframes pc-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) {
  .pc-spin { animation: none; }
  .pc-skeleton-bar { animation: none; }
  .pc-switch-knob { transition: none; }
}
`

    // ---------------------------------------------------------------------
    // Small shared helpers
    // ---------------------------------------------------------------------

    function interpolate(text, params) {
      if (params === undefined || params === null) return text
      return String(text).replace(/\{(\w+)\}/g, (match, name) => (
        params[name] === undefined || params[name] === null ? match : String(params[name])
      ))
    }

    function makeTranslate(bind) {
      return (key, params) => {
        let value = key
        try {
          const raw = typeof bind === 'function' ? bind(key) : undefined
          if (typeof raw === 'string' && raw.length > 0) value = raw
        } catch (error) {
          value = key
        }
        return interpolate(value, params)
      }
    }

    /** Translate function resolved by apply(); components fall back to it. */
    let translate = (key, params) => interpolate(String(key), params)

    /** Prefer the slot-provided `t` when the Host passes one, else our own. */
    function componentTranslate(props, key, params) {
      const base = typeof props?.t === 'function' ? props.t : translate
      let value = key
      try {
        const raw = base(key)
        if (typeof raw === 'string' && raw.length > 0) value = raw
      } catch (error) {
        value = key
      }
      return interpolate(value, params)
    }

    function sessionKey(sessionId) {
      return sessionId === undefined || sessionId === null ? '' : String(sessionId)
    }

    function isNonEmptyString(value) {
      return typeof value === 'string' && value.length > 0
    }

    function readInputValue(useInput, selector, fallback) {
      try {
        if (typeof useInput === 'function') {
          const value = useInput(selector)
          if (value !== undefined) return value
        }
      } catch (error) {
        // A composer snapshot that is mid-transition must not blank the slot.
      }
      return fallback
    }

    async function readJson(response) {
      try {
        return await response.json()
      } catch (error) {
        return null
      }
    }

    function hostMessage(payload) {
      if (payload !== null && typeof payload === 'object' && isNonEmptyString(payload.message)) return payload.message
      return null
    }

    function isAbortError(error) {
      return error !== null && typeof error === 'object'
        && (error.name === 'AbortError' || error.code === 20)
    }

    function stripPlaceholders(value) {
      return String(value ?? '').replace(CHIP_PLACEHOLDER_GLOBAL_RE, '')
    }

    function hasChipPlaceholder(value) {
      return typeof value === 'string' && CHIP_PLACEHOLDER_RE.test(value)
    }

    function isPlaceholderAt(text, index) {
      if (!Number.isFinite(index) || index < 0 || index >= text.length) return false
      return CHIP_PLACEHOLDER_RE.test(text.charAt(index))
    }

    // ---------------------------------------------------------------------
    // Attachment projections
    //
    // `occurrences` carry attachment chips in CLIPBOARD coordinates
    // (`{ offset, length, clipboardText }`). `insertText` takes DETECT offsets,
    // where every chip is a single placeholder character. planInsertion() and
    // modelText() convert between the two. They accept either projection of the
    // draft (the contract's detect projection, or a clipboard projection from a
    // host that reports whole chip labels) and detect which one they were given
    // by checking whether the computed chip offsets land on placeholders.
    // ---------------------------------------------------------------------

    function normalizeOccurrences(occurrences) {
      if (!Array.isArray(occurrences)) return []
      const entries = []
      occurrences.forEach((raw, index) => {
        if (raw === null || typeof raw !== 'object') return
        const offset = Number(raw.offset)
        if (!Number.isFinite(offset) || offset < 0) return
        const length = Number(raw.length)
        // Idempotent: already-normalised entries carry `label` instead of
        // `clipboardText`, and must keep their label when re-normalised.
        const label = isNonEmptyString(raw.clipboardText)
          ? raw.clipboardText
          : (isNonEmptyString(raw.label) ? raw.label : '')
        const size = Number.isFinite(length) && length > 0 ? Math.floor(length) : label.length
        if (size <= 0) return
        entries.push({ offset: Math.floor(offset), length: size, label, order: index })
      })
      entries.sort((left, right) => left.offset - right.offset || left.order - right.order)
      return entries
    }

    function labelLengthOf(entry) {
      return entry.label.length > 0 ? entry.label.length : entry.length
    }

    /** Whether the draft uses detect placeholders for these chips. */
    function isDetectProjection(text, entries) {
      if (entries.length === 0) return false
      let shift = 0
      for (const entry of entries) {
        const position = entry.offset - shift
        if (!isPlaceholderAt(text, position)) return false
        shift += Math.max(0, labelLengthOf(entry) - 1)
      }
      return true
    }

    function totalLabelShift(entries) {
      let shift = 0
      for (const entry of entries) shift += Math.max(0, labelLengthOf(entry) - 1)
      return shift
    }

    /**
     * Plain-text runs of the draft that may be replaced without eating a chip.
     * Returned spans are in DETECT coordinates, ascending, non-overlapping.
     *
     * @param {string} originRaw - draft captured when the request started.
     * @param {Array} occurrences - composer chip projections.
     * @returns {Array<{start:number,end:number}>}
     */
    function planInsertion(originRaw, occurrences) {
      const text = String(originRaw ?? '')
      const entries = normalizeOccurrences(occurrences)
      if (entries.length === 0) {
        return text.length === 0 ? [] : [{ start: 0, end: text.length }]
      }
      const detect = isDetectProjection(text, entries)
      const detectEnd = detect ? text.length : Math.max(0, text.length - totalLabelShift(entries))
      const spans = []
      let shift = 0
      let cursor = 0
      for (const entry of entries) {
        let start = entry.offset - shift
        if (detect && !isPlaceholderAt(text, start)) {
          // Snap to the next placeholder rather than replacing through a chip.
          start = findPlaceholderFrom(text, cursor)
        }
        if (!Number.isFinite(start) || start < cursor) start = cursor
        if (start > detectEnd) start = detectEnd
        spans.push({ start, end: Math.min(detectEnd, start + 1) })
        cursor = start + 1
        shift += Math.max(0, labelLengthOf(entry) - 1)
      }
      const segments = []
      let position = 0
      for (const span of spans) {
        if (span.start > position) segments.push({ start: position, end: span.start })
        if (span.end > position) position = span.end
      }
      if (position < detectEnd) segments.push({ start: position, end: detectEnd })
      if (segments.length === 0 && detectEnd > 0) segments.push({ start: detectEnd, end: detectEnd })
      return segments
    }

    function findPlaceholderFrom(text, from) {
      for (let index = Math.max(0, from); index < text.length; index += 1) {
        if (CHIP_PLACEHOLDER_RE.test(text.charAt(index))) return index
      }
      return text.length
    }

    function shortenAttachmentName(label) {
      const bare = String(label ?? '').trim().replace(/^@/u, '')
      if (bare.length === 0) return 'attachment'
      const url = /^https?:\/\/([^/\s?#]+)/iu.exec(bare)
      if (url !== null) return url[1].slice(0, 120)
      const leaf = bare.split(/[\\/]/u).filter(Boolean).pop()
      const name = String(leaf || bare).slice(0, 120)
      return name.length > 0 ? name : 'attachment'
    }

    function attachmentMarker(index, name) {
      return '[' + ATTACHMENT_LABEL + String(index) + ': ' + name + ']'
    }

    /**
     * Draft as the Host should see it: each chip becomes the attachment marker.
     *
     * @param {string} originRaw - draft in either projection.
     * @param {Array} occurrences - composer chip projections.
     * @returns {string}
     */
    function modelText(originRaw, occurrences) {
      const text = String(originRaw ?? '')
      const entries = normalizeOccurrences(occurrences)
      if (entries.length === 0) return text
      const detect = isDetectProjection(text, entries)
      const markers = entries.map((entry, index) => attachmentMarker(
        index + 1,
        shortenAttachmentName(entry.label.length > 0 ? entry.label : text.slice(entry.offset, entry.offset + labelLengthOf(entry))),
      ))
      if (detect) {
        let output = ''
        let cursor = 0
        let shift = 0
        entries.forEach((entry, index) => {
          let start = entry.offset - shift
          if (!isPlaceholderAt(text, start)) start = findPlaceholderFrom(text, cursor)
          if (!Number.isFinite(start) || start < cursor) start = cursor
          if (start > text.length) start = text.length
          output += text.slice(cursor, start) + markers[index]
          cursor = Math.min(text.length, start + 1)
          shift += Math.max(0, labelLengthOf(entry) - 1)
        })
        return output + text.slice(cursor)
      }
      let output = ''
      let cursor = 0
      entries.forEach((entry, index) => {
        const start = Math.max(cursor, Math.min(text.length, entry.offset))
        const end = Math.max(start, Math.min(text.length, start + labelLengthOf(entry)))
        output += text.slice(cursor, start) + markers[index]
        cursor = end
      })
      return output + text.slice(cursor)
    }

    /** Attachment descriptors for the request body. */
    function attachmentsFromOccurrences(originRaw, occurrences) {
      const text = String(originRaw ?? '')
      return normalizeOccurrences(occurrences).map((entry, index) => {
        const label = entry.label.length > 0
          ? entry.label
          : text.slice(entry.offset, entry.offset + labelLengthOf(entry))
        return { index: index + 1, name: shortenAttachmentName(label), kind: 'file' }
      })
    }

    /** Rebuild the draft a successful insertion should leave behind. */
    function expectedAppliedText(originRaw, segments, clean) {
      const text = String(originRaw ?? '')
      if (segments.length === 1 && segments[0].start === 0 && segments[0].end === text.length) return clean
      let output = ''
      let cursor = 0
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]
        output += text.slice(cursor, segment.start)
        output += index === segments.length - 1 ? clean : ''
        cursor = segment.end
      }
      return output + text.slice(cursor)
    }

    // ---------------------------------------------------------------------
    // Pure helpers exposed for the tests: apply.__internals
    // ---------------------------------------------------------------------

    function ratioOf(origin, next) {
      const left = String(origin ?? '').length
      const right = String(next ?? '').length
      if (left === 0) return 1
      const ratio = right / left
      return Number.isFinite(ratio) ? ratio : 1
    }

    function normalizeAnswers(input) {
      const list = []
      const push = (question, answer) => {
        if (!isNonEmptyString(question)) return
        if (!isNonEmptyString(answer)) return
        const text = answer.trim()
        if (text.length === 0) return
        list.push({ q: question, a: text })
      }
      if (Array.isArray(input)) {
        for (const item of input) {
          if (item === null || typeof item !== 'object') continue
          push(typeof item.q === 'string' ? item.q : '', typeof item.a === 'string' ? item.a : '')
        }
        return list
      }
      if (input !== null && typeof input === 'object') {
        for (const question of Object.keys(input)) {
          const answer = input[question]
          if (typeof answer === 'string') push(question, answer)
        }
      }
      return list
    }

    function answersToMap(answers) {
      const map = {}
      if (!Array.isArray(answers)) return map
      for (const item of answers) {
        if (item === null || typeof item !== 'object') continue
        if (!isNonEmptyString(item.q) || !isNonEmptyString(item.a)) continue
        map[item.q] = item.a
      }
      return map
    }

    function normalizeRevise(input) {
      if (input === null || typeof input !== 'object') return null
      if (!isNonEmptyString(input.id)) return null
      if (typeof input.text !== 'string') return null
      return {
        id: input.id,
        text: input.text,
        instruction: input.instruction === 'specific' ? 'specific' : 'shorter',
      }
    }

    /**
     * Request body for POST /api/prompt-craft/enhance.
     *
     * @param {object} input - { sessionId, draft, attachments, answers, revise }
     * @returns {object}
     */
    function buildEnhanceBody(input) {
      const source = input !== null && typeof input === 'object' ? input : {}
      const body = { draft: String(source.draft ?? '') }
      if (isNonEmptyString(source.sessionId)) body.sessionId = source.sessionId
      if (Array.isArray(source.attachments)) {
        const attachments = []
        source.attachments.forEach((item, index) => {
          if (item === null || typeof item !== 'object') return
          const name = isNonEmptyString(item.name) ? item.name : ''
          if (name.length === 0) return
          attachments.push({
            index: Number.isFinite(item.index) ? item.index : index + 1,
            name,
            kind: item.kind === 'link' ? 'link' : 'file',
          })
        })
        if (attachments.length > 0) body.attachments = attachments
      }
      const answers = normalizeAnswers(source.answers)
      if (answers.length > 0) body.answers = answers
      const revise = normalizeRevise(source.revise)
      if (revise !== null) body.revise = revise
      return body
    }

    // ---------------------------------------------------------------------
    // Diff tokens: mark the fragments of `next` that are not in `origin`.
    // ---------------------------------------------------------------------

    const LATIN_OR_PUNCT_RE = /[^\s\u3400-\u9fff\uf900-\ufaff]+/u
    const CJK_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff]/u

    function tokenize(value) {
      const text = String(value ?? '')
      const tokens = []
      let index = 0
      while (index < text.length) {
        const rest = text.slice(index)
        const character = text.charAt(index)
        if (/\s/u.test(character)) {
          let end = index + 1
          while (end < text.length && /\s/u.test(text.charAt(end))) end += 1
          tokens.push(text.slice(index, end))
          index = end
          continue
        }
        if (CJK_CHAR_RE.test(character)) {
          tokens.push(character)
          index += 1
          continue
        }
        const match = LATIN_OR_PUNCT_RE.exec(rest)
        const chunk = match !== null && match.index === 0 ? match[0] : character
        tokens.push(chunk)
        index += chunk.length
      }
      return tokens
    }

    function lcsMatchedFlags(left, right) {
      const rows = left.length
      const columns = right.length
      const width = columns + 1
      const table = new Int32Array((rows + 1) * width)
      for (let row = rows - 1; row >= 0; row -= 1) {
        for (let column = columns - 1; column >= 0; column -= 1) {
          table[row * width + column] = left[row] === right[column]
            ? table[(row + 1) * width + column + 1] + 1
            : Math.max(table[(row + 1) * width + column], table[row * width + column + 1])
        }
      }
      const matched = new Uint8Array(columns)
      let row = 0
      let column = 0
      while (row < rows && column < columns) {
        if (left[row] === right[column]) {
          matched[column] = 1
          row += 1
          column += 1
        } else if (table[(row + 1) * width + column] >= table[row * width + column + 1]) {
          row += 1
        } else {
          column += 1
        }
      }
      return matched
    }

    function prefixSuffixMatchedFlags(left, right) {
      let prefix = 0
      while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1
      let suffix = 0
      while (
        suffix < left.length - prefix
        && suffix < right.length - prefix
        && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
      ) {
        suffix += 1
      }
      const matched = new Uint8Array(right.length)
      for (let index = 0; index < prefix; index += 1) matched[index] = 1
      for (let index = right.length - suffix; index < right.length; index += 1) matched[index] = 1
      return matched
    }

    /**
     * Word/character diff used by the compare toggle.
     *
     * @param {string} origin - the draft the rewrite was based on.
     * @param {string} next - candidate text.
     * @returns {Array<{text:string,added:boolean}>} tokens covering `next`.
     */
    function diffTokens(origin, next) {
      const from = String(origin ?? '')
      const to = String(next ?? '')
      if (to.length === 0) return []
      if (from === to) return [{ text: to, added: false }]
      const left = tokenize(from)
      const right = tokenize(to)
      if (left.length === 0) return [{ text: to, added: true }]
      const matched = left.length * right.length <= DIFF_PAIR_BUDGET
        ? lcsMatchedFlags(left, right)
        : prefixSuffixMatchedFlags(left, right)
      const tokens = []
      for (let index = 0; index < right.length; index += 1) {
        const added = matched[index] === 0
        const previous = tokens[tokens.length - 1]
        if (previous !== undefined && previous.added === added) previous.text += right[index]
        else tokens.push({ text: right[index], added })
      }
      return tokens
    }

    // ---------------------------------------------------------------------
    // Session-scoped task registry
    //
    // A task belongs to a sessionId instead of a component instance, so
    // switching conversations neither cancels the request nor loses the
    // result. Components subscribe per session and read the record on every
    // render; no task state lives in component state.
    // ---------------------------------------------------------------------

    const tasks = new Map()
    const taskListeners = new Map()
    // The panel and the button live in two different slots, so the composer's
    // live session key is published by the session-scoped button and read by the
    // panel. The button element is kept too: a future floating seat needs it.
    let currentSessionKey = ''
    const buttonNodes = new Map()
    // The overlay panel has no composer props of its own, so the session-scoped
    // button publishes the live composer face (draft, revision, chips, actions)
    // for it on every render. Without this the panel could preview but never
    // apply, because insertText lives on the composer's props.
    let composerBridge = { key: '', draft: '', draftRev: 0, occurrences: [], inputActions: null }

    function notifyTask(key) {
      const listeners = taskListeners.get(key)
      if (listeners === undefined) return
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (error) {
          // A broken listener must not take the panel or the button down.
        }
      }
    }

    function subscribeTask(key, listener) {
      if (typeof listener !== 'function') return () => {}
      let listeners = taskListeners.get(key)
      if (listeners === undefined) {
        listeners = new Set()
        taskListeners.set(key, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && taskListeners.get(key) === listeners) taskListeners.delete(key)
      }
    }

    function createTask() {
      return {
        phase: 'idle',
        controller: null,
        originRaw: '',
        originModel: '',
        originRev: 0,
        originOccurrences: [],
        questions: [],
        answers: {},
        candidates: [],
        meta: null,
        error: null,
        applied: null,
        collapsed: false,
        refused: false,
        kind: 'enhance',
        reviseTarget: null,
        lastAnswers: {},
        lastRevise: null,
      }
    }

    function getTask(key) {
      const task = tasks.get(key)
      return task === undefined ? null : task
    }

    function ensureTask(key) {
      let task = tasks.get(key)
      if (task === undefined) {
        task = createTask()
        tasks.set(key, task)
      }
      return task
    }

    function patchTask(key, changes) {
      const task = ensureTask(key)
      Object.assign(task, changes)
      notifyTask(key)
      return task
    }

    function normalizeCandidate(raw, index) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const id = isNonEmptyString(source.id) ? source.id : `candidate-${index + 1}`
      return {
        id,
        label: isNonEmptyString(source.label) ? source.label : id,
        text: typeof source.text === 'string' ? source.text : '',
        warnings: Array.isArray(source.warnings) ? source.warnings.filter((item) => typeof item === 'string') : [],
      }
    }

    function normalizeCandidates(raw) {
      if (!Array.isArray(raw)) return []
      const candidates = []
      raw.forEach((item, index) => {
        const candidate = normalizeCandidate(item, index)
        if (candidate.text.length > 0) candidates.push(candidate)
      })
      return candidates
    }

    function normalizeQuestions(raw) {
      if (!Array.isArray(raw)) return []
      const questions = []
      for (const item of raw) {
        if (questions.length >= 2) break
        if (item === null || typeof item !== 'object') continue
        if (!isNonEmptyString(item.q)) continue
        questions.push({
          q: item.q,
          why: isNonEmptyString(item.why) ? item.why : '',
          options: Array.isArray(item.options)
            ? item.options.filter((option) => isNonEmptyString(option)).slice(0, 6)
            : [],
        })
      }
      return questions
    }

    function normalizeMeta(raw) {
      if (raw === null || typeof raw !== 'object') return null
      return {
        provider: isNonEmptyString(raw.provider) ? raw.provider : '',
        model: isNonEmptyString(raw.model) ? raw.model : '',
        elapsedMs: Number.isFinite(raw.elapsedMs) ? raw.elapsedMs : null,
        context: raw.context === true,
        repaired: raw.repaired === true,
      }
    }

    function settleError(key, controller, message) {
      const task = tasks.get(key)
      if (task === undefined || task.controller !== controller) return
      patchTask(key, { phase: 'error', error: message, controller: null })
    }

    /**
     * Start (or restart) a craft task for one session.
     *
     * @param {string} sessionId - composer session.
     * @param {object} request - { draft, occurrences, draftRev, answers, revise }
     * @returns {AbortController|null}
     */
    function startTask(sessionId, request) {
      const input = request !== null && typeof request === 'object' ? request : {}
      const key = sessionKey(sessionId)
      const draft = typeof input.draft === 'string' ? input.draft : ''
      const occurrences = normalizeOccurrences(input.occurrences)
      const revise = normalizeRevise(input.revise)
      const isRevise = revise !== null
      if (!isRevise && draft.trim().length === 0 && !hasChipPlaceholder(draft)) return null
      const previous = getTask(key)
      const answers = isRevise ? undefined : normalizeAnswers(input.answers)
      const answersMap = isRevise ? (previous?.answers ?? {}) : answersToMap(answers)
      const originRaw = isRevise ? (previous?.originRaw ?? draft) : draft
      const originOccurrences = isRevise ? (previous?.originOccurrences ?? occurrences) : occurrences
      const originModel = isRevise
        ? (previous?.originModel ?? modelText(originRaw, originOccurrences))
        : modelText(draft, occurrences)
      const controller = new AbortController()
      const body = buildEnhanceBody({
        sessionId: key.length > 0 ? key : undefined,
        draft: isRevise ? originModel : modelText(draft, occurrences),
        attachments: isRevise ? [] : attachmentsFromOccurrences(draft, occurrences),
        answers,
        revise,
      })
      patchTask(key, {
        phase: 'running',
        controller,
        error: null,
        refused: false,
        kind: isRevise ? 'revise' : 'enhance',
        reviseTarget: isRevise ? revise : null,
        originRaw,
        originModel,
        originRev: Number.isFinite(input.draftRev)
          ? input.draftRev
          : (isRevise ? (previous?.originRev ?? 0) : 0),
        originOccurrences,
        questions: isRevise ? (previous?.questions ?? []) : [],
        answers: answersMap,
        candidates: isRevise ? (previous?.candidates ?? []) : [],
        meta: isRevise ? (previous?.meta ?? null) : null,
        applied: isRevise ? (previous?.applied ?? null) : null,
        collapsed: isRevise ? (previous?.collapsed ?? false) : false,
        lastAnswers: isRevise ? (previous?.lastAnswers ?? {}) : answersMap,
        lastRevise: isRevise ? revise : null,
      })
      // Fire and forget: any transport/host failure has already been folded into
      // the task record, and a rejected promise must not escape apply().
      requestEnhance(key, body, controller, { isRevise, revise }).catch(() => {})
      return controller
    }

    async function requestEnhance(key, body, controller, context) {
      let response
      try {
        response = await fetch(ENHANCE_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return
        settleError(key, controller, translate('error.network'))
        return
      }
      const payload = await readJson(response)
      if (controller.signal.aborted) return
      const task = tasks.get(key)
      if (task === undefined || task.controller !== controller) return
      if (response.ok !== true) {
        settleError(key, controller, hostMessage(payload) ?? translate('error.http', { status: response.status }))
        return
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        settleError(key, controller, hostMessage(payload) ?? translate('error.badPayload'))
        return
      }
      applyEnhanceSuccess(key, controller, payload, context)
    }

    function applyEnhanceSuccess(key, controller, payload, context) {
      const task = tasks.get(key)
      if (task === undefined || task.controller !== controller) return
      const candidates = normalizeCandidates(payload.candidates)
      if (context.isRevise) {
        const target = context.revise
        const replacement = candidates[0]
        if (replacement === undefined) {
          settleError(key, controller, translate('error.empty'))
          return
        }
        const current = Array.isArray(task.candidates) ? task.candidates : []
        const replaced = current.map((candidate) => (candidate.id === target.id ? replacement : candidate))
        if (!replaced.some((candidate) => candidate.id === replacement.id)) replaced.push(replacement)
        patchTask(key, {
          phase: 'ready',
          controller: null,
          candidates: replaced,
          meta: normalizeMeta(payload.meta) ?? task.meta,
          error: null,
          refused: false,
        })
        return
      }
      if (candidates.length === 0) {
        settleError(key, controller, translate('error.empty'))
        return
      }
      patchTask(key, {
        phase: 'ready',
        controller: null,
        questions: normalizeQuestions(payload.questions),
        candidates,
        meta: normalizeMeta(payload.meta),
        error: null,
        refused: false,
        applied: null,
        collapsed: false,
      })
    }

    /** Cancel the in-flight run for a session; the draft is left untouched. */
    function abortTask(sessionId) {
      const key = sessionKey(sessionId)
      const task = getTask(key)
      if (task === null || task.phase !== 'running') return
      try {
        task.controller?.abort?.()
      } catch (error) {
        // Nothing to cancel.
      }
      const restoreReady = task.kind === 'revise' && Array.isArray(task.candidates) && task.candidates.length > 0
      patchTask(key, { phase: restoreReady ? 'ready' : 'idle', controller: null, error: null })
    }

    /** Drop everything known about a session (the panel's close button). */
    function closeTask(sessionId) {
      const key = sessionKey(sessionId)
      const task = getTask(key)
      if (task !== null && task.controller !== null) {
        try {
          task.controller.abort?.()
        } catch (error) {
          // Already gone.
        }
      }
      tasks.delete(key)
      notifyTask(key)
    }

    function readLiveRev(inputActions, fallback) {
      try {
        if (inputActions !== undefined && inputActions !== null && typeof inputActions.captureInsertion === 'function') {
          const insertion = inputActions.captureInsertion()
          if (insertion !== null && insertion !== undefined && Number.isFinite(insertion.draftRev)) return insertion.draftRev
        }
      } catch (error) {
        // Fall back to the revision captured when the run started.
      }
      return fallback
    }

    function callInsert(inputActions, text, segment, draftRev) {
      try {
        return inputActions.insertText(text, { start: segment.start, end: segment.end, draftRev }) === true
      } catch (error) {
        return false
      }
    }

    /**
     * Write one candidate into the composer.
     *
     * Whole-draft replacement when the draft carries no chip; otherwise every
     * plain-text run is replaced back-to-front so chips keep their positions.
     * Only the right-most run receives the new text; the others are cleared.
     *
     * @returns {boolean} whether the composer accepted the edit.
     */
    function applyCandidate(sessionId, candidate, inputActions) {
      const key = sessionKey(sessionId)
      const task = getTask(key)
      if (task === null || candidate === null || typeof candidate !== 'object') return false
      if (inputActions === undefined || inputActions === null || typeof inputActions.insertText !== 'function') {
        patchTask(key, { refused: true })
        return false
      }
      try {
        const clean = stripPlaceholders(candidate.text)
        const originRaw = String(task.originRaw ?? '')
        const segments = planInsertion(originRaw, task.originOccurrences)
        if (segments.length === 0) {
          patchTask(key, { refused: true })
          return false
        }
        let liveRev = Number.isFinite(task.originRev) ? task.originRev : 0
        for (let index = segments.length - 1; index >= 0; index -= 1) {
          const segment = segments[index]
          const payload = index === segments.length - 1 ? clean : ''
          liveRev = readLiveRev(inputActions, liveRev)
          if (callInsert(inputActions, payload, segment, liveRev)) continue
          // The composer rejected the span; retry once with a fresh revision.
          liveRev = readLiveRev(inputActions, liveRev)
          if (callInsert(inputActions, payload, segment, liveRev)) continue
          patchTask(key, { refused: true })
          return false
        }
        patchTask(key, {
          phase: 'ready',
          controller: null,
          applied: { text: expectedAppliedText(originRaw, segments, clean), at: Date.now() },
          collapsed: true,
          refused: false,
          error: null,
        })
        return true
      } catch (error) {
        patchTask(key, { refused: true, error: null })
        return false
      }
    }

    /** Cached GET /settings read used to pick the default compare mode. */
    let settingsPreferencePromise = null

    function readShowDiffPreference() {
      if (settingsPreferencePromise === null) {
        settingsPreferencePromise = (async () => {
          try {
            const response = await fetch(SETTINGS_PATH, {
              method: 'GET',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
            })
            const payload = await readJson(response)
            if (response.ok !== true) return null
            if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
            const values = payload.values
            if (values === null || typeof values !== 'object') return null
            return values.showDiff !== false
          } catch (error) {
            return null
          }
        })()
      }
      return settingsPreferencePromise
    }

    // ---------------------------------------------------------------------
    // Icons (currentColor only; the one exception the contract allows)
    // ---------------------------------------------------------------------

    function SparkIcon() {
      return h('svg', {
        className: 'pc-icon',
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'M8 1.8l1.45 3.95 3.95 1.45-3.95 1.45L8 12.6 6.55 8.65 2.6 7.2l3.95-1.45L8 1.8z',
        fill: 'currentColor',
        stroke: 'none',
      }))
    }

    function CheckIcon() {
      return h('svg', {
        className: 'pc-icon',
        width: 15,
        height: 15,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'M3.2 8.6l3 3 6.4-6.4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function Spinner() {
      return h('span', { className: 'pc-spin', 'aria-hidden': 'true' })
    }

    function DotIcon() {
      return h('span', { className: 'pc-dot', 'aria-hidden': 'true' })
    }

    // ---------------------------------------------------------------------
    // Composer toolbar button (conversation.input.right)
    // ---------------------------------------------------------------------

    function CraftButton(props) {
      const key = sessionKey(props?.sessionId)
      const buttonRef = useRef(null)
      const [, setVersion] = useState(0)
      useEffect(() => {
        currentSessionKey = key
        const node = buttonRef.current
        if (node !== null && node !== undefined) buttonNodes.set(key, node)
        return () => {
          if (currentSessionKey === key) currentSessionKey = ''
          if (node !== null && buttonNodes.get(key) === node) buttonNodes.delete(key)
          if (composerBridge.key === key) composerBridge = { key: '', draft: '', draftRev: 0, occurrences: [], inputActions: null }
        }
      }, [key])
      useEffect(() => subscribeTask(key, () => setVersion((value) => value + 1)), [key])

      const t = (translationKey, params) => componentTranslate(props, translationKey, params)
      const draft = readInputValue(props?.useInput, (state) => state.draft, '')
      const occurrences = readInputValue(props?.useInput, (state) => state.occurrences, [])
      const draftRev = readInputValue(props?.useInput, (state) => state.draftRev, 0)
      const task = getTask(key)
      composerBridge = { key, draft, draftRev, occurrences, inputActions: props?.inputActions }

      try {
        // Nothing to craft: the seat stays empty rather than showing a dead control.
        if (typeof draft !== 'string' || (draft.trim().length === 0 && !hasChipPlaceholder(draft))) return null
        const phase = task === null ? 'idle' : task.phase
        const state = phase === 'running' ? 'running' : phase === 'ready' ? 'ready' : phase === 'error' ? 'error' : 'idle'
        const labelKey = state === 'running'
          ? 'button.running'
          : state === 'ready'
            ? 'button.done'
            : state === 'error'
              ? 'button.failed'
              : 'button.idle'
        const label = t(labelKey)
        const icon = state === 'running'
          ? h(Spinner, null)
          : state === 'ready'
            ? h(CheckIcon, null)
            : state === 'error'
              ? h(DotIcon, null)
              : h(SparkIcon, null)
        const handleClick = () => {
          try {
            const current = getTask(key)
            if (current !== null && current.phase === 'running') {
              abortTask(key)
              return
            }
            startTask(key, { draft, occurrences, draftRev })
          } catch (error) {
            // A click must never throw into the composer row.
          }
        }
        return h('button', {
          type: 'button',
          ref: buttonRef,
          className: 'pc-btn-root',
          'data-state': state,
          'aria-label': label,
          title: label,
          onClick: handleClick,
        }, icon)
      } catch (error) {
        return null
      }
    }

    // ---------------------------------------------------------------------
    // Preview / compare panel (conversation.composer.dock)
    // ---------------------------------------------------------------------

    function warningText(code, t) {
      const value = String(code ?? '')
      const invented = /^invented:(\d+)$/u.exec(value)
      if (invented !== null) return t('warning.invented', { count: Number(invented[1]) })
      switch (value) {
        case 'template': return t('warning.template')
        case 'bloat': return t('warning.bloat')
        case 'placeholder': return t('warning.placeholder')
        case 'repaired': return t('warning.repaired')
        default: return t('warning.unknown')
      }
    }

    function formatRatio(value) {
      const ratio = Number.isFinite(value) ? value : 1
      return ratio.toFixed(1)
    }

    function panelMetaBits(task, t) {
      const bits = []
      const meta = task.meta !== null && typeof task.meta === 'object' ? task.meta : null
      const model = meta === null ? '' : (isNonEmptyString(meta.model) ? meta.model : (isNonEmptyString(meta.provider) ? meta.provider : ''))
      if (model.length > 0) bits.push(model)
      if (meta !== null && Number.isFinite(meta.elapsedMs)) {
        bits.push(t('panel.elapsed', { seconds: (meta.elapsedMs / 1000).toFixed(1) }))
      }
      return bits
    }

    function CraftPanel(props) {
      const key = currentSessionKey.length > 0 ? currentSessionKey : sessionKey(props?.sessionId)
      const task = getTask(key)
      // The overlay is mounted for the whole frame, but the preference read is
      // only useful once something is actually on screen.
      const shown = task !== null && task.phase !== 'idle'
      const [, setVersion] = useState(0)
      const [copiedId, setCopiedId] = useState(null)
      const [diffPreferences, setDiffPreferences] = useState({})
      const [showDiffDefault, setShowDiffDefault] = useState(false)
      useEffect(() => subscribeTask(key, () => setVersion((value) => value + 1)), [key])
      useEffect(() => {
        if (!shown) return undefined
        let cancelled = false
        readShowDiffPreference().then((value) => {
          if (cancelled) return
          if (typeof value === 'boolean') setShowDiffDefault(value)
        }, () => {})
        return () => {
          cancelled = true
        }
      }, [shown])

      const t = (translationKey, params) => componentTranslate(props, translationKey, params)

      try {
        // The panel must never hold an empty shell.
        if (task === null || task.phase === 'idle') return null

        const bridged = composerBridge.key === key
        const draft = bridged ? composerBridge.draft : readInputValue(props?.useInput, (state) => state.draft, '')
        const occurrences = bridged ? composerBridge.occurrences : readInputValue(props?.useInput, (state) => state.occurrences, [])
        const draftRev = bridged ? composerBridge.draftRev : readInputValue(props?.useInput, (state) => state.draftRev, 0)
        const inputActions = bridged ? composerBridge.inputActions : props?.inputActions

        const isDiffOn = (candidateId) => {
          const explicit = diffPreferences[candidateId]
          return explicit === undefined ? showDiffDefault : explicit === true
        }
        const toggleDiff = (candidateId) => {
          setDiffPreferences((previous) => {
            const current = previous[candidateId] === undefined ? showDiffDefault : previous[candidateId]
            return { ...previous, [candidateId]: current !== true }
          })
        }
        const handleCopy = (candidate) => {
          try {
            const clipboard = typeof navigator !== 'undefined' && navigator !== null ? navigator.clipboard : undefined
            if (clipboard !== undefined && clipboard !== null && typeof clipboard.writeText === 'function') {
              const result = clipboard.writeText(candidate.text)
              if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
                result.then(() => {}, () => {})
              }
            }
            setCopiedId(candidate.id)
            const timer = setTimeout(() => {
              try {
                setCopiedId((current) => (current === candidate.id ? null : current))
              } catch (error) {
                // Component may be gone.
              }
            }, COPY_RESET_MS)
            if (timer !== null && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
          } catch (error) {
            // Copy failures are silent by contract.
          }
        }
        const setAnswer = (question, value) => {
          const current = getTask(key)
          if (current === null) return
          const answers = { ...(current.answers ?? {}) }
          const text = String(value ?? '')
          if (text.length === 0) delete answers[question]
          else answers[question] = text
          patchTask(key, { answers })
        }
        const submitAnswers = () => {
          try {
            const current = getTask(key)
            startTask(key, {
              draft,
              occurrences,
              draftRev,
              answers: current?.answers ?? {},
            })
          } catch (error) {
            // Rendered error state is handled by the store.
          }
        }
        const retry = () => {
          try {
            const current = getTask(key)
            if (current === null) return
            if (current.kind === 'revise' && current.lastRevise !== null) {
              startTask(key, {
                draft: current.originRaw,
                occurrences: current.originOccurrences,
                draftRev: current.originRev,
                revise: current.lastRevise,
              })
              return
            }
            startTask(key, {
              draft: current.originRaw,
              occurrences: current.originOccurrences,
              draftRev: current.originRev,
              answers: current.lastAnswers ?? {},
            })
          } catch (error) {
            // Leave the error visible.
          }
        }
        const header = (closeLabel) => h('div', { className: 'pc-panel-head' },
          h('span', { className: 'pc-panel-title' }, t('panel.title')),
          panelMetaBits(task, t).length > 0
            ? h('span', { className: 'pc-panel-meta' }, panelMetaBits(task, t).join(' · '))
            : null,
          h('button', {
            type: 'button',
            className: 'pc-icon-btn',
            'aria-label': closeLabel,
            title: closeLabel,
            onClick: () => closeTask(key),
          }, '×'))

        if (task.phase === 'running') {
          return h('div', { className: 'pc-panel', 'data-phase': 'running', 'data-panel': 'prompt-craft' },
            header(t('panel.cancel')),
            h('div', { className: 'pc-skeleton', 'aria-label': t('panel.running') },
              h('i', { className: 'pc-skeleton-bar' }),
              h('i', { className: 'pc-skeleton-bar' }),
              h('i', { className: 'pc-skeleton-bar' })),
            h('div', { className: 'pc-panel-actions' },
              h('span', { className: 'pc-panel-meta' }, t('panel.running')),
              h('button', { type: 'button', className: 'pc-btn', onClick: () => abortTask(key) }, t('panel.cancel'))))
        }

        if (task.phase === 'error') {
          return h('div', { className: 'pc-panel', 'data-phase': 'error', 'data-panel': 'prompt-craft' },
            header(t('panel.close')),
            h('p', { className: 'pc-error', role: 'alert' }, task.error ?? t('error.badPayload')),
            h('div', { className: 'pc-panel-actions' },
              h('button', { type: 'button', className: 'pc-btn pc-btn-primary', onClick: retry }, t('panel.retry')),
              h('button', { type: 'button', className: 'pc-btn', onClick: () => closeTask(key) }, t('panel.close'))))
        }

        // Applied results fold into a one-line summary until expanded.
        if (task.applied !== null && task.collapsed === true) {
          return h('div', { className: 'pc-panel pc-panel-summary', 'data-phase': 'ready', 'data-panel': 'prompt-craft' },
            h('span', { className: 'pc-check', 'aria-hidden': 'true' }, '✓'),
            h('span', { className: 'pc-summary-text' }, t('panel.summary', { count: task.candidates.length })),
            h('span', { className: 'pc-summary-spacer' }),
            h('button', { type: 'button', className: 'pc-btn', onClick: () => patchTask(key, { collapsed: false }) }, t('panel.expand')),
            h('button', { type: 'button', className: 'pc-btn', onClick: () => closeTask(key) }, t('panel.close')))
        }

        const stale = task.applied !== null && draft !== task.applied.text
        const renderCard = (candidate) => {
          const diffOn = isDiffOn(candidate.id)
          let tokens = null
          if (diffOn) {
            try {
              tokens = diffTokens(task.originModel, candidate.text)
            } catch (error) {
              tokens = [{ text: candidate.text, added: false }]
            }
          }
          const ratio = ratioOf(task.originModel, candidate.text)
          return h('article', { className: 'pc-card', key: candidate.id, 'data-candidate': candidate.id },
            h('div', { className: 'pc-card-head' },
              h('span', { className: 'pc-card-label' }, candidate.label),
              h('span', { className: 'pc-ratio', title: t('card.ratio', { ratio: formatRatio(ratio) }) },
                t('card.ratio', { ratio: formatRatio(ratio) })),
              candidate.warnings.map((warning, warningIndex) => {
                const text = warningText(warning, t)
                return h('span', {
                  className: 'pc-warn',
                  key: `warning-${warningIndex}`,
                  title: text,
                }, text)
              })),
            diffOn
              ? h('div', { className: 'pc-card-text pc-diff' }, tokens.map((token, tokenIndex) => (
                token.added
                  ? h('mark', { className: 'pc-add', key: `token-${tokenIndex}` }, token.text)
                  : h('span', { key: `token-${tokenIndex}` }, token.text)
              )))
              : h('div', { className: 'pc-card-text' }, candidate.text),
            h('div', { className: 'pc-card-actions' },
              h('button', {
                type: 'button',
                className: 'pc-btn pc-btn-ghost',
                'aria-pressed': diffOn,
                onClick: () => toggleDiff(candidate.id),
              }, diffOn ? t('card.compareOff') : t('card.compare')),
              h('button', {
                type: 'button',
                className: 'pc-btn pc-btn-primary',
                onClick: stale
                  ? () => startTask(key, { draft, occurrences, draftRev })
                  : () => applyCandidate(key, candidate, inputActions),
              }, stale ? t('panel.staleApply') : t('card.apply')),
              h('button', {
                type: 'button',
                className: 'pc-btn',
                onClick: () => startTask(key, {
                  draft,
                  occurrences,
                  draftRev,
                  revise: { id: candidate.id, text: candidate.text, instruction: 'shorter' },
                }),
              }, t('card.shorter')),
              h('button', {
                type: 'button',
                className: 'pc-btn',
                onClick: () => startTask(key, {
                  draft,
                  occurrences,
                  draftRev,
                  revise: { id: candidate.id, text: candidate.text, instruction: 'specific' },
                }),
              }, t('card.specific')),
              h('button', {
                type: 'button',
                className: 'pc-btn',
                onClick: () => handleCopy(candidate),
              }, copiedId === candidate.id ? t('card.copied') : t('card.copy'))))
        }

        const renderQuestions = () => {
          if (!Array.isArray(task.questions) || task.questions.length === 0) return null
          const nodes = task.questions.map((question, index) => {
            const answer = task.answers?.[question.q] ?? ''
            const optionChips = question.options.map((option) => h('button', {
              type: 'button',
              key: option,
              className: 'pc-chip',
              'aria-pressed': answer === option,
              'data-selected': answer === option ? 'true' : undefined,
              onClick: () => setAnswer(question.q, answer === option ? '' : option),
            }, option))
            const answerInput = h('input', {
              type: 'text',
              className: 'pc-answer-input',
              value: answer,
              placeholder: t('panel.answerPlaceholder'),
              maxLength: ANSWER_MAX,
              onChange: (event) => setAnswer(question.q, event.target.value),
            })
            return h('div', { className: 'pc-question', key: `question-${index}` },
              h('div', { className: 'pc-question-text' }, `${index + 1}. ${question.q}`),
              question.why.length > 0 ? h('p', { className: 'pc-question-why' }, question.why) : null,
              h('div', { className: 'pc-question-row' }, optionChips, answerInput))
          })
          const actions = h('div', { className: 'pc-question-actions' },
            h('button', { type: 'button', className: 'pc-btn pc-btn-primary', onClick: submitAnswers }, t('panel.questionsSubmit')),
            h('button', {
              type: 'button',
              className: 'pc-btn pc-btn-ghost',
              onClick: () => patchTask(key, { questions: [], answers: {} }),
            }, t('panel.questionsIgnore')))
          return h('section', { className: 'pc-questions' },
            h('h3', { className: 'pc-questions-title' }, t('panel.questionsTitle')),
            nodes,
            actions)
        }

        return h('div', {
          className: 'pc-panel',
          'data-phase': 'ready',
          'data-panel': 'prompt-craft',
          role: 'region',
          'aria-label': t('panel.title'),
        },
          header(t('panel.close')),
          task.applied !== null ? h('div', { className: 'pc-applied' }, t('panel.applied')) : null,
          task.refused === true ? h('div', { className: 'pc-refused', role: 'alert' }, t('panel.refused')) : null,
          renderQuestions(),
          h('div', { className: 'pc-cards' }, task.candidates.map(renderCard)),
          h('div', { className: 'pc-panel-actions' },
            h('button', { type: 'button', className: 'pc-btn', onClick: () => closeTask(key) }, t('panel.close'))))
      } catch (error) {
        // Rendering must never escape: a thrown slot blanks the whole dock.
        return h('div', { className: 'pc-panel', 'data-panel': 'prompt-craft' },
          h('div', { className: 'pc-panel-head' },
            h('span', { className: 'pc-panel-title' }, componentTranslate(props, 'panel.title'))))
      }
    }

    // ---------------------------------------------------------------------
    // Settings page (settings.section)
    // ---------------------------------------------------------------------

    const DEFAULT_SETTINGS = Object.freeze({
      preferences: '',
      context: true,
      showDiff: true,
      provider: '',
      model: '',
    })

    function normalizeValues(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        preferences: typeof source.preferences === 'string' ? source.preferences.slice(0, PREFERENCES_MAX) : '',
        context: source.context !== false,
        showDiff: source.showDiff !== false,
        provider: isNonEmptyString(source.provider) ? source.provider : '',
        model: isNonEmptyString(source.model) ? source.model : '',
      }
    }

    function normalizeCatalog(raw) {
      const providers = raw !== null && typeof raw === 'object' && Array.isArray(raw.providers) ? raw.providers : []
      const groups = []
      for (const provider of providers) {
        if (provider === null || typeof provider !== 'object' || !isNonEmptyString(provider.id)) continue
        const models = Array.isArray(provider.models)
          ? provider.models
            .filter((model) => model !== null && typeof model === 'object' && isNonEmptyString(model.id))
            .map((model) => ({ id: model.id, name: isNonEmptyString(model.name) ? model.name : model.id }))
          : []
        if (models.length === 0) continue
        groups.push({
          id: provider.id,
          name: isNonEmptyString(provider.name) ? provider.name : provider.id,
          models,
        })
      }
      return groups
    }

    function CraftSettings(props) {
      const t = (translationKey, params) => componentTranslate(props, translationKey, params)
      const [values, setValues] = useState(null)
      const [catalog, setCatalog] = useState({ status: 'loading', groups: [] })
      const [status, setStatus] = useState('loading')
      const [message, setMessage] = useState(null)
      const alive = useRef(true)
      alive.current = true

      useEffect(() => {
        alive.current = true
        let cancelled = false
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        ;(async () => {
          try {
            const response = await fetch(SETTINGS_PATH, {
              method: 'GET',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
              signal: controller === null ? undefined : controller.signal,
            })
            const payload = await readJson(response)
            if (cancelled) return
            if (response.ok !== true || payload === null || typeof payload !== 'object' || payload.ok !== true) {
              // Degrade: still show preferences and switches, follow the
              // conversation model, and say that the catalog is unavailable.
              setValues({ ...DEFAULT_SETTINGS })
              setCatalog({ status: 'error', groups: [] })
              setStatus('loadError')
              setMessage(hostMessage(payload) ?? t('error.http', { status: response.status }))
              return
            }
            setValues(normalizeValues(payload.values))
            const groups = normalizeCatalog(payload.catalog)
            setCatalog({ status: groups.length > 0 ? 'ready' : 'empty', groups })
            setStatus('idle')
            setMessage(null)
          } catch (error) {
            if (cancelled) return
            setValues({ ...DEFAULT_SETTINGS })
            setCatalog({ status: 'error', groups: [] })
            setStatus('loadError')
            setMessage(t('error.network'))
          }
        })()
        return () => {
          cancelled = true
          alive.current = false
          try {
            controller?.abort?.()
          } catch (error) {
            // Already gone.
          }
        }
        // The dictionary is stable for the lifetime of the section.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const updateValues = (patch) => {
        setValues((previous) => (previous === null ? previous : { ...previous, ...patch }))
      }

      const handleModelChange = (event) => {
        const raw = String(event?.target?.value ?? '')
        if (raw === '') {
          updateValues({ provider: '', model: '' })
          return
        }
        const separator = raw.indexOf(':')
        if (separator <= 0) return
        updateValues({ provider: raw.slice(0, separator), model: raw.slice(separator + 1) })
      }

      const handleSave = () => {
        if (values === null) return
        setStatus('saving')
        setMessage(null)
        const body = {
          preferences: values.preferences,
          context: values.context === true,
          showDiff: values.showDiff === true,
        }
        // The initial read failed: we never learned the stored model pin, so
        // writing our defaults here would silently clear it.
        if (status !== 'loadError') {
          body.provider = values.provider
          body.model = values.model
        }
        ;(async () => {
          try {
            const response = await fetch(SETTINGS_PATH, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            const payload = await readJson(response)
            if (!alive.current) return
            if (response.ok === true && payload !== null && typeof payload === 'object' && payload.ok === true) {
              setValues(normalizeValues(payload.values ?? body))
              setStatus('saved')
              setMessage(null)
              return
            }
            setStatus('saveError')
            setMessage(hostMessage(payload) ?? t('error.http', { status: response.status }))
          } catch (error) {
            if (!alive.current) return
            setStatus('saveError')
            setMessage(t('error.network'))
          }
        })()
      }

      try {
        if (values === null) {
          return h('div', { className: 'pc-settings', 'data-prompt-craft-settings': '' },
            h('h2', { className: 'pc-settings-title' }, t('nav')),
            status === 'loadError'
              ? h('p', { className: 'pc-status', role: 'status', 'data-kind': 'error' },
                t('settings.loadFailed', { message: message ?? '' }))
              : h('p', { className: 'pc-status', role: 'status' }, t('settings.loading')))
        }

        let statusText = ''
        let statusKind
        if (status === 'loading') statusText = t('settings.reading')
        else if (status === 'saving') statusText = t('settings.saving')
        else if (status === 'saved') {
          statusText = t('settings.saved')
          statusKind = 'saved'
        } else if (status === 'saveError') {
          statusText = t('settings.saveFailed', { message: message ?? '' })
          statusKind = 'error'
        } else if (status === 'loadError') {
          statusText = t('settings.loadFailed', { message: message ?? '' })
          statusKind = 'error'
        }

        const switchRow = (id, title, hint, checked, onToggle) => h('div', { className: 'pc-toggle', 'data-row': id },
          h('div', { className: 'pc-toggle-copy' },
            h('span', { className: 'pc-field-label' }, title),
            h('span', { className: 'pc-field-hint' }, hint)),
          h('button', {
            type: 'button',
            className: 'pc-switch',
            role: 'switch',
            'aria-checked': checked ? 'true' : 'false',
            'aria-label': title,
            'data-on': checked ? 'true' : 'false',
            disabled: status === 'saving',
            onClick: () => onToggle(!checked),
          }, h('i', { className: 'pc-switch-knob', 'aria-hidden': 'true' })))

        const modelValue = values.provider.length > 0 && values.model.length > 0
          ? `${values.provider}:${values.model}`
          : ''
        const modelOptions = []
        modelOptions.push(h('option', { key: 'follow', value: '' }, t('settings.model.follow')))
        if (catalog.status === 'loading') {
          modelOptions.push(h('option', { key: 'loading', value: '', disabled: true }, t('settings.model.loading')))
        } else if (catalog.status === 'error' || catalog.status === 'empty') {
          modelOptions.push(h('option', { key: 'unavailable', value: '', disabled: true }, t('settings.model.loadFailed')))
        } else {
          for (const group of catalog.groups) {
            modelOptions.push(h('optgroup', { key: group.id, label: group.name },
              group.models.map((model) => h('option', {
                key: `${group.id}:${model.id}`,
                value: `${group.id}:${model.id}`,
              }, model.name))))
          }
        }

        return h('div', { className: 'pc-settings', 'data-prompt-craft-settings': '' },
          h('h2', { className: 'pc-settings-title' }, t('nav')),
          h('p', { className: 'pc-settings-intro' }, t('settings.intro')),
          h('label', { className: 'pc-field' },
            h('span', { className: 'pc-field-label' }, t('settings.preferences.title')),
            h('textarea', {
              className: 'pc-textarea',
              maxLength: PREFERENCES_MAX,
              rows: 4,
              placeholder: t('settings.preferences.placeholder'),
              value: values.preferences,
              onChange: (event) => updateValues({ preferences: event.target.value }),
            })),
          switchRow(
            'context',
            t('settings.context.title'),
            t('settings.context.hint'),
            values.context === true,
            (next) => updateValues({ context: next }),
          ),
          switchRow(
            'showDiff',
            t('settings.showDiff.title'),
            t('settings.showDiff.hint'),
            values.showDiff === true,
            (next) => updateValues({ showDiff: next }),
          ),
          h('label', { className: 'pc-field' },
            h('span', { className: 'pc-field-label' }, t('settings.model.title')),
            h('select', {
              className: 'pc-select',
              value: modelValue,
              'aria-label': t('settings.model.title'),
              onChange: handleModelChange,
            }, modelOptions)),
          h('div', { className: 'pc-settings-actions' },
            h('button', {
              type: 'button',
              className: 'pc-btn pc-btn-primary',
              disabled: status === 'saving',
              onClick: handleSave,
            }, t('settings.save')),
            h('span', {
              className: 'pc-status',
              role: 'status',
              'data-kind': statusKind,
            }, statusText)))
      } catch (error) {
        return h('div', { className: 'pc-settings', 'data-prompt-craft-settings': '' },
          h('h2', { className: 'pc-settings-title' }, componentTranslate(props, 'nav')))
      }
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function installStyles() {
      try {
        if (typeof document === 'undefined' || document === null) return () => {}
        if (typeof document.createElement !== 'function') return () => {}
        const style = document.createElement('style')
        style.setAttribute('data-prompt-craft', '')
        style.textContent = css
        const parent = document.head ?? document.documentElement
        if (parent === undefined || parent === null || typeof parent.appendChild !== 'function') return () => {}
        parent.appendChild(style)
        return () => {
          try {
            style.remove()
          } catch (error) {
            try {
              style.parentNode?.removeChild?.(style)
            } catch (nested) {
              // The page is being torn down anyway.
            }
          }
        }
      } catch (error) {
        return () => {}
      }
    }

    function registerLocale(ctx) {
      try {
        if (ctx?.locale === undefined || typeof ctx.locale.register !== 'function') return () => {}
        const dispose = ctx.locale.register(NS, { zh, en })
        return typeof dispose === 'function' ? dispose : () => {}
      } catch (error) {
        return () => {}
      }
    }

    function registerSlots(ctx) {
      const disposers = []
      const slots = ctx?.slots
      if (slots === undefined || slots === null || typeof slots.register !== 'function') return () => {}
      const add = (dispose) => {
        if (typeof dispose === 'function') disposers.push(dispose)
      }
      const inject = (name, build) => {
        try {
          if (typeof slots.inject === 'function') add(slots.inject(name, build))
          else add(build())
        } catch (error) {
          // A host without this slot must not block the other two.
        }
      }
      inject(BUTTON_SLOT, () => slots.register({
        name: BUTTON_SLOT,
        id: BUTTON_ID,
        order: BUTTON_ORDER,
      }, CraftButton))
      inject(PANEL_SLOT, () => slots.register({
        name: PANEL_SLOT,
        id: PANEL_ID,
        order: PANEL_ORDER,
      }, CraftPanel))
      inject(SETTINGS_SLOT, () => slots.register({
        name: SETTINGS_SLOT,
        id: SETTINGS_ID,
        order: SETTINGS_ORDER,
        label: () => translate('nav'),
      }, CraftSettings))
      return () => {
        while (disposers.length > 0) {
          const dispose = disposers.pop()
          try {
            dispose()
          } catch (error) {
            // Cleanup must stay quiet.
          }
        }
      }
    }

    function effectOnce(ctx, callback, label) {
      try {
        if (typeof ctx?.effect === 'function') return ctx.effect(callback, label)
        return callback()
      } catch (error) {
        return () => {}
      }
    }

    /**
     * Register the locale tables, the single stylesheet, and the three slots.
     *
     * @param {object} ctx - Client plugin context.
     * @returns {void}
     */
    function apply(ctx) {
      // Dictionaries first: slot labels read them through the bound translate.
      effectOnce(ctx, () => registerLocale(ctx), 'prompt-craft: locale')
      try {
        translate = makeTranslate(ctx?.locale?.bind?.(NS))
      } catch (error) {
        translate = (key, params) => interpolate(String(key), params)
      }
      effectOnce(ctx, installStyles, 'prompt-craft: styles')
      effectOnce(ctx, () => registerSlots(ctx), 'prompt-craft: slots')
    }

    // Pure functions the tests drive directly (CONTRACT §2).
    apply.__internals = { planInsertion, diffTokens, buildEnhanceBody, ratioOf }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
