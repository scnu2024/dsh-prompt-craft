/**
 * Browser half of the prompt-craft plugin.
 *
 * Adds a small "craft the prompt" control to the composer toolbar, a preview
 * panel above the composer where a conservative rewrite can be reviewed and
 * applied, and a settings section. Nothing is written into the composer until
 * the user clicks apply; the Host half owns normalisation and quality checks.
 *
 * The module is a single plain-JS file loaded by the browser module table:
 * React is the only hard requirement, react-dom is used through one guarded
 * require when the host exposes it (the preview is portalled out of the
 * composer's containing block), every colour comes from a theme token, and all
 * user-visible copy lives in the locale tables below.
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
    const { useCallback, useEffect, useRef, useState } = React
    /** Measure before the first paint where the runtime supports it. */
    const useMeasureEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : useEffect

    const NS = 'prompt-craft'
    const BUTTON_SLOT = 'conversation.input.right'
    const PANEL_SLOT = 'conversation.input.overlay'
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
    const ANSWER_MAX = 500
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
      'button.label': 'Craft',
      'button.labelRunning': 'Crafting',
      'button.labelDone': 'Craft again',
      'button.labelFailed': 'Retry',
      'button.questions': 'Confirm details to continue crafting',
      'button.labelQuestions': 'Confirm details',
      'panel.subtitle': 'A clearer path from idea to instruction',
      'panel.changes': 'Improvements in this version',
      'panel.exhausted': 'No further useful detail without new information.',
      'panel.addInformation': 'Add information',
      'panel.newInformation': 'Additional information {round}: what else should this prompt include?',
      'panel.updateInformation': 'Update and craft',
      'error.outdated': 'Please refresh Harness to load the updated crafting service.',
      'error.imagesUnavailable': 'Draft images are unavailable. Reattach the images and refresh Harness if needed.',
      'error.imageRead': 'Could not read the images. Please reattach them and retry.',
      'error.imageLimits': 'Use up to 8 PNG, JPEG, WebP or GIF images, at most 10 MiB each and 20 MiB in total.',
      'error.imageStale': 'The draft or images changed. Craft again using the current composer.',
      'panel.images': 'Referenced {count} image(s)',
      'panel.read': 'Expand reading',
      'panel.compact': 'Return to compact view',
      'panel.previous': 'Previous version · generating a new one',
      'panel.questionsToggle': 'Information needed · {count}',
      'card.original': 'Original draft',
      'card.showOriginal': 'Compare with original',
      'card.hideOriginal': 'Hide original',
      'card.chars': '{before} → {after} characters',
      'card.highlight': 'Highlight changes',
      'warning.details': 'View details',
      'settings.preview.title': 'Context & preview',
      'settings.modelGroup.title': 'Model',
      'settings.preferences.count': '{count} / {max}',
      'settings.preferences.hint': 'Your preferred wording, format and style.',
      'settings.model.hint': 'Used for crafting only. Follow the conversation or choose a dedicated model.',
      'nav': 'Prompt craft',
      'button.idle': 'Craft the prompt: one clearer version',
      'button.running': 'Crafting the prompt; click to cancel',
      'button.done': 'Crafting finished; click to regenerate',
      'button.failed': 'Crafting failed; click to retry',
      'panel.title': 'Crafted versions',
      'panel.close': 'Close',
      'panel.expand': 'Expand',
      'panel.unchanged': 'Current version preserved',
      'panel.running': 'Crafting…',
      'panel.cancel': 'Cancel',
      'panel.retry': 'Retry',
      'panel.summary': 'Crafting finished · {count} version(s)',
      'panel.applied': 'Applied to the composer',
      'panel.refused': 'The composer refused the replacement; the draft is unchanged.',
      'panel.partial': 'Only part of the replacement was accepted. Use Undo to restore your draft, or copy the candidate.',
      'panel.copyFailed': 'Copy failed. Select the candidate text and copy it manually.',
      'panel.waiting': 'Still generating. You can switch conversations and return later.',
      'panel.duration': 'Generating · {seconds}s',
      'error.timeout': 'Crafting timed out. Your draft and the previous result are preserved; please retry.',
      'error.client': 'Crafting encountered an unexpected error. Please retry.',
      'panel.staleApply': 'Draft changed; regenerate',
      'panel.elapsed': '{seconds}s',
      'panel.answerPlaceholder': 'Add an answer…',
      'panel.questionsTitle': 'Confirm the key details',
      'panel.questionsSubmit': 'Regenerate with the answers',
      'panel.questionsIgnore': 'Continue with known information',
      'card.apply': 'Use this version',
      'card.compare': 'Highlight changes',
      'card.compareOff': 'Hide highlights',
      'card.shorter': 'Shorter',
      'card.specific': 'More specific',
      'card.copy': 'Copy',
      'card.copied': 'Copied',
      'card.ratio': '{ratio}x',
      'warning.invented': 'Includes {count} detail(s) absent from your draft; please check',
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
      'error.imagesUnavailable': '无法获取输入框图片，请重新添加图片，必要时刷新 Harness。',
      'error.imageRead': '图片读取失败，请重新添加图片后重试。',
      'error.imageLimits': '最多参考 8 张 PNG、JPEG、WebP 或 GIF 图片，单张不超过 10 MiB，总计不超过 20 MiB。',
      'error.imageStale': '草稿或图片已变化，请基于当前输入框重新打磨。',
      'panel.images': '已参考 {count} 张图片',
      'button.label': '打磨',
      'button.labelRunning': '打磨中',
      'button.labelDone': '再次打磨',
      'button.labelFailed': '重试',
      'button.questions': '先确认信息，再继续打磨',
      'button.labelQuestions': '待确认',
      'panel.subtitle': '让想法更清晰，让指令更好执行',
      'panel.changes': '本轮改进',
      'panel.exhausted': '当前信息下已无进一步具体化空间。',
      'panel.addInformation': '补充信息',
      'panel.newInformation': '补充信息 {round}：还希望这条提示词包含哪些信息？',
      'panel.updateInformation': '补充后继续打磨',
      'error.outdated': '请刷新 Harness，加载新版提示词打磨服务。',
      'panel.read': '展开阅读',
      'panel.compact': '返回浮层',
      'panel.previous': '上一版结果 · 新一版正在生成',
      'panel.questionsToggle': '需要确认 · {count} 项',
      'card.original': '原始草稿',
      'card.showOriginal': '对照原文',
      'card.hideOriginal': '收起原文',
      'card.chars': '{before} → {after} 字',
      'card.highlight': '高亮改动',
      'warning.details': '查看详情',
      'settings.preview.title': '上下文与预览',
      'settings.modelGroup.title': '模型',
      'settings.preferences.count': '{count} / {max}',
      'settings.preferences.hint': '写下你习惯的措辞、格式和表达风格。',
      'settings.model.hint': '仅用于提示词打磨，可跟随会话或选择专用模型。',
      'nav': '提示词打磨',
      'button.idle': '打磨提示词：生成一版更清晰的写法',
      'button.running': '正在打磨提示词，点击可取消',
      'button.done': '打磨完成，点击重新生成',
      'button.failed': '打磨失败，点击重试',
      'panel.title': '打磨结果',
      'panel.close': '关闭',
      'panel.expand': '展开',
      'panel.unchanged': '已保留当前版本',
      'panel.running': '正在打磨…',
      'panel.cancel': '取消',
      'panel.retry': '重试',
      'panel.summary': '打磨完成 · {count} 版',
      'panel.applied': '已应用到输入框',
      'panel.refused': '输入框没有接受替换，草稿不变。',
      'panel.partial': '仅完成了部分替换，请用撤销恢复草稿，或复制候选内容。',
      'panel.copyFailed': '复制失败，请选中候选文字后手动复制。',
      'panel.waiting': '仍在生成，可以切换会话，稍后回来查看。',
      'panel.duration': '正在生成 · {seconds} 秒',
      'error.timeout': '打磨超时了，草稿和上一版结果已保留，请重试。',
      'error.client': '打磨遇到异常，请重试。',
      'panel.staleApply': '草稿已改，重新生成',
      'panel.elapsed': '{seconds} 秒',
      'panel.answerPlaceholder': '补充一句…',
      'panel.questionsTitle': '先确认关键信息',
      'panel.questionsSubmit': '带着答案重新生成',
      'panel.questionsIgnore': '按已有信息继续',
      'card.apply': '应用结果',
      'card.compare': '高亮改动',
      'card.compareOff': '关闭高亮',
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
.pc-panel, .pc-settings, .pc-btn-root {
  --pc-accent: var(--dsw-alias-brand-primary);
  --pc-tint: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1));
  --pc-line: var(--dsw-alias-border-l1);
  --pc-muted: var(--dsw-alias-label-secondary);
  --pc-surface: var(--dsw-alias-bg-layer-1);
  --pc-ink: var(--dsw-alias-label-primary);
  box-sizing: border-box;
  color: var(--pc-ink);
  font-family: inherit;
  text-align: start;
}
.pc-panel *, .pc-settings * { box-sizing: border-box; }
.pc-btn-root {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 28px; min-width: 28px; padding: 0 10px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--pc-accent) 25%, transparent);
  background: linear-gradient(120deg, var(--pc-tint), var(--pc-surface));
  color: var(--pc-accent); font: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background 160ms, box-shadow 160ms;
}
.pc-btn-root:hover { background: var(--pc-tint); box-shadow: 0 2px 10px color-mix(in srgb, var(--pc-accent) 14%, transparent); }
.pc-btn-root[data-state="ready"] { color: var(--dsw-alias-state-success-primary); }
.pc-btn-root[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.pc-icon { display: block; flex: none; }
.pc-spin { display: inline-block; flex: none; width: 14px; height: 14px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: pc-spin .8s linear infinite; }
.pc-dot { display: inline-block; width: 7px; height: 7px; background: currentColor; border-radius: 50%; }
.pc-panel {
  display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  border: 1px solid var(--pc-line); border-radius: 14px;
  background: var(--pc-surface); font-size: 14px; line-height: 1.7;
  box-shadow: 0 16px 48px color-mix(in srgb, var(--pc-ink) 12%, transparent), 0 2px 8px color-mix(in srgb, var(--pc-ink) 5%, transparent);
  animation: pc-enter 160ms ease-out;
}
.pc-modal-layer { position: fixed; inset: 0; z-index: 2147483000; background: color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent); }
.pc-panel-head {
  display: flex; align-items: center; gap: 12px; flex: none; min-width: 0;
  padding: 16px 20px; border-bottom: 1px solid var(--pc-line);
  background: linear-gradient(115deg, var(--pc-tint), var(--pc-surface) 75%);
}
.pc-brand-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 34px; height: 34px; border-radius: 11px; color: var(--pc-accent); background: color-mix(in srgb, var(--pc-accent) 12%, var(--pc-surface)); }
.pc-heading { flex: 1; min-width: 0; }
.pc-panel-title { display: block; font-size: 15px; font-weight: 650; line-height: 1.5; }
.pc-panel-meta { color: var(--pc-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.pc-head-actions { display: flex; gap: 4px; flex: none; }
.pc-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px;
  background: transparent; color: var(--pc-muted); font: inherit; font-size: 18px; cursor: pointer;
}
.pc-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--pc-ink); }
.pc-panel-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 18px 20px; }
.pc-cards { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.pc-card { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.pc-card + .pc-card { border-top: 1px solid var(--pc-line); padding-top: 18px; }
.pc-card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pc-card-label { font-size: 12px; font-weight: 600; color: var(--pc-muted); }
.pc-char-count { margin-inline-start: auto; font-size: 12px; color: var(--pc-muted); font-variant-numeric: tabular-nums; }
.pc-card-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pc-card-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; tab-size: 4; }
.pc-add { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent); color: inherit; border-radius: 3px; padding-block: 1px; box-decoration-break: clone; }
.pc-original { padding: 12px 14px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--pc-line); border-radius: 10px; }
.pc-original-label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--pc-muted); }
.pc-original .pc-card-text { color: var(--pc-muted); }
.pc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 32px; padding: 5px 12px; border: 1px solid var(--pc-line); border-radius: 9px;
  background: var(--pc-surface); color: var(--pc-ink); font: inherit; font-size: 12px; line-height: 1.5;
  cursor: pointer; transition: background 140ms, box-shadow 140ms;
}
.pc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.pc-btn:disabled, .pc-chip:disabled, .pc-switch:disabled { opacity: .5; cursor: default; }
.pc-btn-primary { background: var(--pc-accent); border-color: var(--pc-accent); color: var(--dsw-alias-bg-base); font-weight: 600; }
.pc-btn-primary:hover:not(:disabled) { background: var(--pc-accent); box-shadow: 0 3px 12px color-mix(in srgb, var(--pc-accent) 25%, transparent); }
.pc-btn-ghost { border-color: transparent; background: transparent; color: var(--pc-muted); }
.pc-btn-ghost[aria-pressed="true"] { color: var(--pc-accent); background: var(--pc-tint); }
.pc-panel-actions, .pc-card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pc-panel-foot { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--pc-line); background: var(--pc-surface); }
.pc-card-actions { justify-content: space-between; }
.pc-action-group { display: flex; gap: 6px; align-items: center; }
.pc-panel-foot .pc-panel-actions { justify-content: space-between; }
.pc-error, .pc-refused, .pc-warning { margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }
.pc-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--pc-surface)); }
.pc-refused, .pc-warning { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--pc-surface)); }
.pc-warning { margin-bottom: 0; }
.pc-warn { display: block; }
.pc-warning details { margin-top: 5px; }
.pc-warning summary { cursor: pointer; }
.pc-applied, .pc-check { color: var(--dsw-alias-state-success-primary); }
.pc-applied { margin-bottom: 12px; font-size: 12px; }
.pc-running { display: flex; align-items: center; gap: 8px; color: var(--pc-accent); font-size: 12px; }
.pc-previous { margin: 0 0 14px; font-size: 12px; color: var(--pc-muted); }
.pc-skeleton { display: flex; flex-direction: column; gap: 12px; padding: 10px 0 18px; min-height: 98px; }
.pc-skeleton-bar { display: block; height: 10px; width: 96%; border-radius: 5px; background: linear-gradient(100deg, var(--dsw-alias-bg-layer-2) 25%, var(--pc-tint) 50%, var(--dsw-alias-bg-layer-2) 75%); background-size: 200% 100%; animation: pc-shimmer 1.8s ease-in-out infinite; }
.pc-skeleton-bar:nth-child(2) { width: 85%; }
.pc-skeleton-bar:nth-child(3) { width: 61%; }
.pc-questions { margin-top: 20px; padding: 0; border: 1px solid var(--pc-line); border-radius: 11px; background: var(--dsw-alias-bg-base); }
.pc-questions-toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 12px 14px; border: 0; border-radius: 11px; background: transparent; color: var(--pc-ink); text-align: start; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.pc-questions-content { display: flex; flex-direction: column; gap: 14px; padding: 0 14px 14px; }
.pc-question { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pc-question-text { font-size: 13px; overflow-wrap: anywhere; }
.pc-question-why { margin: 0; font-size: 12px; color: var(--pc-muted); overflow-wrap: anywhere; }
.pc-question-row, .pc-question-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pc-question-row .pc-answer-input { flex: 1 1 180px; min-width: 0; }
.pc-chip { min-height: 28px; max-width: 100%; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--pc-surface); color: var(--pc-ink); font: inherit; font-size: 12px; overflow-wrap: anywhere; cursor: pointer; }
.pc-chip:hover { background: var(--pc-tint); }
.pc-chip[data-selected="true"] { border-color: var(--pc-accent); color: var(--pc-accent); background: var(--pc-tint); }
.pc-answer-input { width: 100%; min-height: 32px; padding: 5px 10px; border: 1px solid var(--pc-line); border-radius: 8px; background: var(--pc-surface); color: var(--pc-ink); font: inherit; font-size: 12px; }
.pc-panel-summary { flex-direction: row; align-items: center; gap: 10px; padding: 12px 16px; }
.pc-summary-text { color: var(--pc-muted); font-size: 12px; }
.pc-summary-spacer { flex: 1; }
.pc-settings { display: flex; flex-direction: column; gap: 18px; max-width: 720px; width: 100%; font-size: 14px; line-height: 1.7; }
.pc-settings-hero { display: flex; align-items: center; gap: 12px; padding-block: 4px 6px; }
.pc-settings-title { margin: 0; font-size: 18px; font-weight: 650; }
.pc-settings-intro, .pc-field-hint { margin: 0; color: var(--pc-muted); font-size: 12px; overflow-wrap: anywhere; }
.pc-settings-group { display: flex; flex-direction: column; gap: 16px; padding: 20px; border: 1px solid var(--pc-line); border-radius: 14px; background: var(--pc-surface); }
.pc-group-title { margin: 0; font-size: 14px; font-weight: 600; }
.pc-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pc-field-label { font-size: 13px; font-weight: 500; }
.pc-field-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pc-field-count { color: var(--pc-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pc-textarea { width: 100%; min-height: 140px; padding: 12px; border: 1px solid var(--pc-line); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--pc-ink); font: inherit; font-size: 13px; line-height: 1.7; resize: vertical; }
.pc-textarea::placeholder, .pc-answer-input::placeholder { color: var(--pc-muted); opacity: .8; }
.pc-toggle { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.pc-toggle + .pc-toggle { border-top: 1px solid var(--pc-line); padding-top: 16px; }
.pc-toggle-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pc-switch { position: relative; flex: none; width: 36px; height: 22px; padding: 0; margin-top: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); cursor: pointer; }
.pc-switch[data-on="true"] { border-color: var(--pc-accent); background: var(--pc-accent); }
.pc-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: transform 140ms ease; }
.pc-switch[data-on="true"] .pc-switch-knob { transform: translateX(14px); }
.pc-select { width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid var(--pc-line); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--pc-ink); font: inherit; font-size: 13px; }
.pc-settings-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pc-status { color: var(--pc-muted); font-size: 12px; overflow-wrap: anywhere; }
.pc-status[data-kind="saved"] { color: var(--dsw-alias-state-success-primary); }
.pc-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
.pc-btn-root:focus-visible, .pc-panel button:focus-visible, .pc-settings button:focus-visible, .pc-panel summary:focus-visible, .pc-panel:focus-visible, .pc-settings select:focus-visible, .pc-textarea:focus-visible, .pc-answer-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }
@media (max-width: 480px) {
  .pc-btn-root { padding: 0 6px; }
  .pc-btn-root-label { display: none; }
  .pc-panel-head { gap: 10px; padding: 12px 14px; }
  .pc-panel-body { padding: 14px; }
  .pc-panel-foot { padding: 10px 14px; }
  .pc-card-actions { display: grid; grid-template-columns: 1fr; }
  .pc-card-actions > .pc-action-group { justify-content: space-between; }
  .pc-card-actions > .pc-action-group:last-child .pc-btn-primary { flex: 1; }
  .pc-brand-icon { width: 30px; height: 30px; }
  .pc-settings-group { padding: 16px; }
  .pc-panel-summary { flex-wrap: wrap; padding: 10px 12px; }
}
@media (max-height: 420px) {
  .pc-panel-head { padding-block: 8px; }
  .pc-panel-foot { padding-block: 8px; }
}
@keyframes pc-spin { to { transform: rotate(360deg); } }
@keyframes pc-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes pc-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .pc-panel, .pc-spin, .pc-skeleton-bar { animation: none; }
  .pc-panel *, .pc-settings *, .pc-btn-root { transition: none; }
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

    /** Bound settings requests, including a stalled JSON body. */
    async function settingsRequest(options = {}, lightweight = false) {
      const controller = new AbortController()
      clientRequests.add(controller)
      const forward = () => controller.abort()
      if (options.signal?.aborted) controller.abort()
      else options.signal?.addEventListener('abort', forward, { once: true })
      let timer
      let cancel
      try {
        const stopped = new Promise((resolve, reject) => {
          cancel = () => { const error = new Error('settings request interrupted'); error.name = 'AbortError'; reject(error) }
          controller.signal.addEventListener('abort', cancel, { once: true })
          timer = setTimeout(() => controller.abort(), 5000)
          timer?.unref?.()
          if (controller.signal.aborted) cancel()
        })
        const work = (async () => {
          const response = await fetch(SETTINGS_PATH + (lightweight ? '?catalog=0' : ''), { credentials: 'same-origin', ...options, signal: controller.signal })
          return { response, payload: await readJson(response) }
        })()
        return await Promise.race([work, stopped])
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', cancel)
        options.signal?.removeEventListener('abort', forward)
        clientRequests.delete(controller)
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
      const body = { protocolVersion: 2, draft: String(source.draft ?? '') }
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
            kind: item.kind === 'image' ? 'image' : item.kind === 'link' ? 'link' : 'file',
          })
        })
        if (attachments.length > 0) body.attachments = attachments
      }
      const answers = normalizeAnswers(source.answers)
      if (answers.length > 0) body.answers = answers
      const revise = normalizeRevise(source.revise)
      if (revise !== null) body.revise = revise
      if (source.clarificationMode === 'proceed') body.clarificationMode = 'proceed'
      if (source.revisionContext) body.revisionContext = source.revisionContext
      if (Array.isArray(source.images) && source.images.length) body.images = source.images
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
    const composerSnapshots = new Map()
    let conversationService
    const fileIdentities = new WeakMap()
    let nextFileIdentity = 1

    function draftAttachments(ids) {
      if (!ids.length) return []
      const entries = conversationService?.resolveDraftAttachments?.(ids)
      if (!Array.isArray(entries) || entries.length !== ids.length) throw new Error('missing attachments')
      return entries
    }

    function attachmentFingerprint(ids) {
      if (!conversationService?.resolveDraftAttachments) return ''
      try { return JSON.stringify(draftAttachments(ids).map(entry => {
        const file = entry.file
        if (file && !fileIdentities.has(file)) fileIdentities.set(file, nextFileIdentity++)
        return [entry.id, entry.kind, file ? fileIdentities.get(file) : null]
      })) } catch { return 'unavailable' }
    }

    /** Encode only current image files. No payload is added to task/cache state. */
    async function prepareDraftImages(ids, signal) {
      let entries
      try { entries = draftAttachments(ids) } catch { throw new Error(translate('error.imagesUnavailable')) }
      const images = entries.map((entry, i) => ({entry, index:i + 1})).filter(({entry}) => entry.kind === 'image')
      if (!images.length) return {images:[], attachments:entries.map((entry, i) => ({index:i+1, name:shortenAttachmentName(entry.file?.name), kind:'file'}))}
      let total = 0
      if (images.length > 8 || images.some(({entry}) => {
        total += entry.file?.size ?? 0
        return !['image/png','image/jpeg','image/webp','image/gif'].includes(entry.file?.type) || !entry.file?.size || entry.file.size > 10 * 1024 * 1024
      }) || total > 20 * 1024 * 1024) throw new Error(translate('error.imageLimits'))
      const {response, payload} = await settingsRequest({method:'GET', headers:{accept:'application/json'}, signal}, true)
      if (!response.ok || payload?.capabilities?.draftImages !== true) throw new Error(translate('error.outdated'))
      const encoded = []
      for (const {entry, index} of images) {
        if (signal.aborted) return null
        let bytes
        try { bytes = new Uint8Array(await entry.file.arrayBuffer()) } catch { throw new Error(translate('error.imageRead')) }
        if (signal.aborted) return null
        if (bytes.byteLength !== entry.file.size) throw new Error(translate('error.imageRead'))
        let binary = ''
        for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768))
        encoded.push({index,name:shortenAttachmentName(entry.file.name),mediaType:entry.file.type,data:btoa(binary)})
      }
      return {images:encoded,attachments:entries.map((entry,i)=>({index:i+1,name:shortenAttachmentName(entry.file?.name),kind:entry.kind==='image'?'image':'file'}))}
    }
    // Ephemeral presentation state never enters the result cache or wire format.
    const views = new Map()
    function viewFor(key) {
      if (!views.has(key)) views.set(key, { expanded: undefined, original: false, diff: {}, questionsClosed: null })
      return views.get(key)
    }
    function patchView(key, changes) {
      Object.assign(viewFor(key), changes)
      notifyTask(key)
    }
    const taskListeners = new Map()
    const CACHE_KEY = 'dsh-prompt-craft:results:v2'
    const CACHE_LIMIT = 20
    let cacheSource
    let cacheSnapshot = null
    const timers = new Map()
    const clientRequests = new Set()
    const preferenceListeners = new Set()
    let runtimeTimeoutMs = 90000
    let showDiffPreference = null

    function savedTask(task) {
      const { originRaw, originModel, originRev, originOccurrences, originAttachmentIds, questions, answers, candidates, meta, applied, collapsed, lastAnswers, lastRevise, restored, status, reason, changes, revisionContext, specificExhausted, clarificationMode, hadImages } = task
      return { originRaw, originModel, originRev, originOccurrences, originAttachmentIds, questions, answers, candidates, meta, applied, collapsed, lastAnswers, lastRevise, restored, status, reason, changes, revisionContext, specificExhausted, clarificationMode, hadImages }
    }

    function cacheEntries() {
      try {
        const storage = globalThis.sessionStorage
        if (storage === cacheSource && cacheSnapshot !== null) return cacheSnapshot
        cacheSource = storage
        const value = JSON.parse(storage?.getItem(CACHE_KEY) ?? '[]')
        cacheSnapshot = Array.isArray(value) ? value.filter((entry) => typeof entry?.key === 'string' && entry.task && typeof entry.task.originRaw === 'string').slice(-CACHE_LIMIT) : []
        return cacheSnapshot
      } catch { return [] }
    }

    function cacheTask(key, task) {
      try {
        const entries = cacheEntries().filter((entry) => entry.key !== key)
        if (task?.phase === 'ready' && (task?.candidates?.length || task?.questions?.length || task?.reason)) entries.push({ key, task: savedTask(task) })
        cacheSnapshot = entries.slice(-CACHE_LIMIT)
        globalThis.sessionStorage?.setItem(CACHE_KEY, JSON.stringify(cacheSnapshot))
      } catch { /* Storage restrictions and quota failures keep the in-memory result usable. */ }
    }

    function clearTimer(key) {
      clearTimeout(timers.get(key))
      timers.delete(key)
    }
    // Both slots receive their own session-scoped input hooks and actions.
    // Only the button's DOM anchor is shared, indexed by that same session.
    const buttonNodes = new Map()

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
        status: null, reason: '', changes: [], revisionContext: { versions: [], improvements: [] },
        specificExhausted: false, clarificationMode: 'ask',
        controller: null,
        originRaw: '',
        originModel: '',
        originRev: 0,
        originOccurrences: [],
        originAttachmentIds: [],
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
        restored: false,
        partial: false,
        fallback: null,
        startedAt: 0,
      }
    }

    function getTask(key) {
      let task = tasks.get(key)
      if (task === undefined) {
        const stored = cacheEntries().find((entry) => entry.key === key)?.task
        if (stored?.applied && stored.collapsed === true) {
          cacheTask(key, null)
        } else if (stored && Array.isArray(stored.candidates)) {
          task = { ...createTask(), ...stored, candidates: normalizeCandidates(stored.candidates), phase: 'ready', restored: true, controller: null }
          if (task.candidates.length || task.questions.length || task.reason) { tasks.set(key, task); cacheTask(key, task) }
          else task = undefined
        }
      }
      if (task?.phase === 'ready' && cacheEntries().at(-1)?.key !== key) cacheTask(key, task)
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
      if (task.phase === 'ready' && ['phase', 'candidates', 'applied', 'collapsed', 'answers', 'questions', 'specificExhausted'].some((field) => Object.prototype.hasOwnProperty.call(changes, field))) cacheTask(key, task)
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
        details: Array.isArray(source.details) ? source.details.filter((item) => typeof item === 'string').slice(0, 8) : [],
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
        unchanged: raw.unchanged === true,
        context: raw.context === true,
        repaired: raw.repaired === true,
        reasoningEffort: typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort : '',
        imagesUsed: Number.isSafeInteger(raw.imagesUsed) && raw.imagesUsed > 0 ? raw.imagesUsed : 0,
      }
    }

    function settleError(key, controller, message) {
      const task = tasks.get(key)
      if (task === undefined || task.controller !== controller) return
      clearTimer(key)
      const fallback = task.fallback
      patchTask(key, { ...(fallback ?? {}), phase: fallback ? 'ready' : 'error', error: message, lastAnswers: task.lastAnswers, lastRevise: task.lastRevise, clarificationMode: task.clarificationMode, controller: null, fallback: null })
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
      const previous = getTask(key)
      if (previous?.restored && previous.hadImages && draft === (previous.applied?.text ?? previous.originRaw)) {
        let available = false
        try { available = draftAttachments(input.attachmentIds ?? []).some(entry=>entry.kind==='image') } catch {}
        if (!available) {
          patchTask(key, {error:translate('error.imagesUnavailable'),collapsed:false})
          return null
        }
      }
      const same = previous && !taskIsStale(previous, { draft, occurrences, draftRev: input.draftRev, attachmentIds: input.attachmentIds ?? [] })
      const revise = same ? normalizeRevise(input.revise ?? (input.resume ? previous.lastRevise : null)) : null
      const isRevise = revise !== null
      if (!isRevise && draft.trim().length === 0 && !hasChipPlaceholder(draft) && !input.attachmentIds?.length) return null
      const answersMap = { ...(same ? previous.lastAnswers : {}), ...answersToMap(normalizeAnswers(same || !previous ? input.answers : {})) }
      const answers = normalizeAnswers(answersMap)
      const continuing = same && (isRevise || input.resume)
      const originRaw = continuing ? previous.originRaw : draft
      const originOccurrences = continuing ? previous.originOccurrences : occurrences
      const originModel = continuing ? previous.originModel : modelText(draft, occurrences)
      const revisionContext = same ? previous.revisionContext : { versions: [], improvements: [] }
      const clarificationMode = input.clarificationMode === 'proceed' ? 'proceed' : 'ask'
      const controller = new AbortController()
      previous?.controller?.abort?.()
      clearTimer(key)
      const fallback = same ? (previous.fallback ?? (previous.phase === 'ready' ? savedTask(previous) : null)) : null
      const body = buildEnhanceBody({ sessionId: key.length > 0 ? key : undefined,
        draft: originModel, attachments: attachmentsFromOccurrences(originRaw, originOccurrences),
        answers, revise, revisionContext, clarificationMode })
      patchTask(key, {
        phase: 'running', controller, error: null, refused: false, partial: false, restored: false, fallback,
        startedAt: Date.now(), kind: isRevise ? 'revise' : 'enhance', reviseTarget: revise,
        originRaw, originModel, originRev: continuing ? previous.originRev : (Number.isFinite(input.draftRev) ? input.draftRev : 0),
        originOccurrences, originAttachmentIds: continuing ? previous.originAttachmentIds : (input.attachmentIds ?? []),
        originFingerprint: attachmentFingerprint(input.attachmentIds ?? []), hadImages: continuing ? previous.hadImages : false,
        questions: continuing ? previous.questions : [], answers: answersMap,
        candidates: continuing ? previous.candidates : [], meta: continuing ? previous.meta : null,
        applied: continuing ? previous.applied : null, collapsed: false,
        lastAnswers: answersMap, lastRevise: revise, revisionContext, clarificationMode,
        status: null, reason: '', changes: [], specificExhausted: false,
      })
      // Fire and forget: any transport/host failure has already been folded into
      // the task record, and a rejected promise must not escape apply().
      const armTimeout = () => {
        clearTimer(key)
        if (getTask(key)?.controller !== controller) return
        const timer = setTimeout(() => {
          settleError(key, controller, translate('error.timeout'))
          controller.abort()
        }, runtimeTimeoutMs + 10000)
        timer?.unref?.()
        timers.set(key, timer)
      }
      armTimeout()
      readShowDiffPreference().then(armTimeout, () => {})
      ;(async () => {
        try {
          const ids = input.attachmentIds ?? []
          // Resolve browser-owned files only at request time, never from DOM or cached bytes.
          if (ids.length && conversationService?.resolveDraftAttachments) {
            const prepared = await prepareDraftImages(ids, controller.signal)
            if (!prepared || controller.signal.aborted || tasks.get(key)?.controller !== controller) return
            const live = composerSnapshots.get(key)
            if (live && taskIsStale(tasks.get(key), live)) throw new Error(translate('error.imageStale'))
            if (same && previous.hadImages && !prepared.images.length) throw new Error(translate('error.imagesUnavailable'))
            if (prepared.images.length) {
              body.images = prepared.images
              body.language = translate('button.label') === 'Craft' ? 'en' : 'zh'
              patchTask(key, {hadImages:true})
            }
            body.attachments = [...prepared.attachments, ...(body.attachments ?? []).filter(entry=>!prepared.attachments.some(other=>other.name===entry.name))]
          } else if (ids.length || (same && previous.hadImages)) throw new Error(translate('error.imagesUnavailable'))
          await requestEnhance(key, body, controller, {isRevise,revise})
        } catch (error) {
          if (!controller.signal.aborted) settleError(key,controller,error.message || translate('error.imageRead'))
        }
      })()
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
      const live = composerSnapshots.get(key)
      if (task.hadImages && live && taskIsStale(task, live)) { settleError(key,controller,translate('error.imageStale')); return }
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
      clearTimer(key)
      if (payload.protocolVersion !== 2) { settleError(key, controller, translate('error.outdated')); return }
      const status = payload.status
      if (!['needs_input', 'ready', 'unchanged', 'blocked'].includes(status)) { settleError(key, controller, translate('error.badPayload')); return }
      const candidates = normalizeCandidates(payload.candidates)
      const questions = normalizeQuestions(payload.questions)
      if (status === 'needs_input' && !questions.length) { settleError(key, controller, translate('error.badPayload')); return }
      if ((status === 'ready' || status === 'unchanged') && !candidates.length) { settleError(key, controller, translate('error.empty')); return }
      const changes = Array.isArray(payload.changes) ? payload.changes.filter(c => typeof c?.summary === 'string').slice(0, 8) : []
      const previousContext = task.revisionContext ?? { versions: [], improvements: [] }
      const revisionContext = status === 'ready' ? {
        versions: [...previousContext.versions, { text: candidates[0].text, operation: context.revise?.instruction ?? 'enhance' }].slice(-3),
        improvements: [...new Set([...previousContext.improvements, ...changes.map(c => c.summary)])].slice(-24),
      } : previousContext
      patchTask(key, {
        phase: 'ready', controller: null, status, reason: typeof payload.reason === 'string' ? payload.reason : '',
        questions, candidates: status === 'needs_input' || status === 'blocked' ? (task.candidates.length ? task.candidates : task.fallback?.candidates ?? []) : candidates,
        meta: normalizeMeta(payload.meta), changes, revisionContext,
        specificExhausted: payload.meta?.specificExhausted === true,
        error: null, refused: false, applied: task.applied, collapsed: false, fallback: null,
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
      clearTimer(key)
      const fallback = task.fallback
      patchTask(key, { ...(fallback ?? {}), phase: fallback || restoreReady ? 'ready' : 'idle', controller: null, error: null, fallback: null })
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
      views.delete(key)
      clearTimer(key)
      cacheTask(key, null)
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
    function taskIsStale(task, snapshot) {
      const expected = task.applied?.text ?? task.originRaw
      if (snapshot.draft !== expected) return true
      if (JSON.stringify(snapshot.attachmentIds ?? []) !== JSON.stringify(task.originAttachmentIds ?? [])) return true
      if (task.hadImages) {
        try { if (!draftAttachments(snapshot.attachmentIds ?? []).some(entry=>entry.kind==='image')) return true } catch { return true }
      }
      if (task.originFingerprint && attachmentFingerprint(snapshot.attachmentIds ?? []) !== task.originFingerprint) return true
      if (!task.applied && JSON.stringify(normalizeOccurrences(snapshot.occurrences)) !== JSON.stringify(normalizeOccurrences(task.originOccurrences))) return true
      const revision = readLiveRev(snapshot.inputActions, snapshot.draftRev)
      return !task.restored && revision !== (task.applied?.rev ?? task.originRev)
    }

    function applyCandidate(sessionId, candidate, inputActions, snapshot) {
      const key = sessionKey(sessionId)
      const task = getTask(key)
      if (task === null || task.phase !== 'ready' || task.status === 'needs_input' || candidate === null || typeof candidate !== 'object') return false
      if (inputActions === undefined || inputActions === null || typeof inputActions.insertText !== 'function') {
        patchTask(key, { refused: true })
        return false
      }
      if (taskIsStale(task, { ...snapshot, inputActions })) {
        patchTask(key, { refused: false, error: translate('panel.staleApply') })
        return false
      }
      try {
        const clean = stripPlaceholders(candidate.text)
        if (task.applied?.candidateText === clean && snapshot.draft === task.applied.text) {
          closeTask(key)
          return true
        }
        const originRaw = String(snapshot.draft ?? '')
        const segments = originRaw.length === 0 && task.hadImages ? [{start:0,end:0}] : planInsertion(originRaw, snapshot.occurrences)
        if (segments.length === 0) {
          patchTask(key, { refused: true })
          return false
        }
        let liveRev = readLiveRev(inputActions, snapshot.draftRev)
        let completed = 0
        for (let index = segments.length - 1; index >= 0; index -= 1) {
          const segment = segments[index]
          const payload = index === segments.length - 1 ? clean : ''
          if (!callInsert(inputActions, payload, segment, liveRev)) {
            patchTask(key, { refused: completed === 0, partial: completed > 0 })
            return false
          }
          completed += 1
          liveRev = readLiveRev(inputActions, liveRev + 1)
        }
        closeTask(key)
        return true
      } catch (error) {
        patchTask(key, { partial: true, error: null })
        return false
      }
    }

    /** Cached GET /settings read used to pick the default compare mode. */
    let settingsPreferencePromise = null

    function publishPreferences(values, limits) {
      showDiffPreference = values?.showDiff !== false
      if (Number.isFinite(limits?.timeoutMs)) runtimeTimeoutMs = Math.max(1, Math.min(600000, limits.timeoutMs))
      settingsPreferencePromise = Promise.resolve(showDiffPreference)
      for (const listener of preferenceListeners) listener(showDiffPreference)
    }

    function readShowDiffPreference() {
      if (settingsPreferencePromise === null) {
        settingsPreferencePromise = (async () => {
          try {
            const { response, payload } = await settingsRequest({ method: 'GET', headers: { accept: 'application/json' } }, true)
            if (response.ok !== true) return null
            if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
            const values = payload.values
            if (values === null || typeof values !== 'object') return null
            publishPreferences(values, payload.limits)
            return showDiffPreference
          } catch (error) {
            return null
          }
        })()
      }
      return settingsPreferencePromise.then((value) => {
        if (value === null) settingsPreferencePromise = null
        return value
      })
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
      useEffect(() => subscribeTask(key, () => setVersion((value) => value + 1)), [key])

      const t = (translationKey, params) => componentTranslate(props, translationKey, params)
      const draft = readInputValue(props?.useInput, (state) => state.draft, '')
      const occurrences = readInputValue(props?.useInput, (state) => state.occurrences, [])
      const draftRev = readInputValue(props?.useInput, (state) => state.draftRev, 0)
      const attachmentIds = readInputValue(props?.useInput, (state) => state.attachmentIds, [])
      composerSnapshots.set(key, {draft, occurrences, draftRev, attachmentIds, inputActions:props?.inputActions})
      const task = getTask(key)
      // An empty composer renders no button. A callback ref also runs when
      // typing first makes it visible, unlike a session-only mount effect.
      const setButtonNode = useCallback((node) => {
        const previous = buttonRef.current
        buttonRef.current = node
        if (node !== null && node !== undefined) buttonNodes.set(key, node)
        else if (buttonNodes.get(key) === previous) buttonNodes.delete(key)
      }, [key])

      try {
        // Nothing to craft: the seat stays empty rather than showing a dead control.
        if (typeof draft !== 'string' || (draft.trim().length === 0 && !hasChipPlaceholder(draft) && !attachmentIds.length)) return null
        const phase = task === null ? 'idle' : task.phase
        const state = phase === 'running' ? 'running' : task?.status === 'needs_input' ? 'questions' : task?.status === 'blocked' ? 'error' : phase === 'ready' ? 'ready' : phase === 'error' ? 'error' : 'idle'
        const labelKey = state === 'questions' ? 'button.questions' : state === 'running'
          ? 'button.running'
          : state === 'ready'
            ? 'button.done'
            : state === 'error'
              ? 'button.failed'
              : 'button.idle'
        const label = t(labelKey)
        const icon = state === 'questions' ? h('span', { 'aria-hidden': true }, '?') : state === 'running'
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
            if (current?.status === 'needs_input' && !taskIsStale(current, { draft, occurrences, draftRev, attachmentIds, inputActions: props?.inputActions })) { patchView(key, { questionsClosed: null }); patchTask(key, { collapsed: false }); return }
            startTask(key, { draft, occurrences, draftRev: readLiveRev(props?.inputActions, draftRev), attachmentIds })
          } catch (error) {
            patchTask(key, { phase: 'error', error: t('error.client'), controller: null })
          }
        }
        return h('button', {
          type: 'button',
          ref: setButtonNode,
          className: 'pc-btn-root',
          'data-state': state,
          'aria-label': label,
          title: label,
          onClick: handleClick,
        }, icon, h('span', { className: 'pc-btn-root-label' }, t(state === 'questions' ? 'button.labelQuestions' : state === 'running' ? 'button.labelRunning' : state === 'ready' ? 'button.labelDone' : state === 'error' ? 'button.labelFailed' : 'button.label')))
      } catch (error) {
        return null
      }
    }

    // ---------------------------------------------------------------------
    // Preview / compare panel (conversation.input.overlay)
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

    function panelMetaBits(task, t) {
      const bits = []
      const meta = task.meta !== null && typeof task.meta === 'object' ? task.meta : null
      if (meta?.unchanged === true) bits.push(t('panel.unchanged'))
      if (meta?.imagesUsed > 0) bits.push(t('panel.images', {count:meta.imagesUsed}))
      const model = meta === null ? '' : (isNonEmptyString(meta.model) ? meta.model : (isNonEmptyString(meta.provider) ? meta.provider : ''))
      if (model.length > 0) bits.push(model)
      if (meta !== null && Number.isFinite(meta.elapsedMs)) {
        bits.push(t('panel.elapsed', { seconds: (meta.elapsedMs / 1000).toFixed(1) }))
      }
      return bits
    }

    /**
     * `react-dom` is exposed to package modules next to React; the composer
     * slots sit inside the composer card, whose layout contains fixed children
     * (the slot ledger asks fixed overlays to portal to the document body for
     * exactly this reason). Resolve it lazily so a missing entry can never
     * break module evaluation, and keep the plain element as the fallback.
     *
     * @param {object} element - React element to lift to the document body.
     * @returns {object} a portal when available, the element otherwise.
     */
    let portalCreate = undefined
    function portalToBody(element) {
      if (portalCreate === undefined) {
        portalCreate = null
        try {
          const dom = require('react-dom')
          if (dom !== null && typeof dom === 'object' && typeof dom.createPortal === 'function') {
            portalCreate = dom.createPortal
          }
        } catch (error) {
          portalCreate = null
        }
      }
      if (portalCreate === null) return element
      try {
        if (typeof document === 'undefined' || document === null) return element
        const body = document.body
        if (body === null || body === undefined) return element
        return portalCreate(element, body)
      } catch (error) {
        return element
      }
    }

    /**
     * Box of the composer card, found by walking up from our own toolbar
     * button to the element the conversation shell marks with
     * `data-composer-card`. The height heuristic is only a fallback for hosts
     * that predate the marker, and a full-height layout wrapper is rejected
     * because in the hero layout it would anchor the panel off-screen.
     *
     * @param {object} node - the toolbar button element.
     * @returns {{ top: number, left: number, width: number } | null} viewport box.
     */
    function composerBoxOf(node) {
      const boxFrom = (element) => {
        try {
          if (typeof element.getBoundingClientRect !== 'function') return null
          const rect = element.getBoundingClientRect()
          if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return null
          if (rect.width <= 240) return null
          return { top: rect.top, left: rect.left, width: rect.width }
        } catch (error) {
          return null
        }
      }

      try {
        let current = node
        for (let depth = 0; depth < 12 && current !== null && current !== undefined; depth += 1) {
          if (typeof current.getAttribute === 'function' && current.getAttribute('data-composer-card') !== null) {
            return boxFrom(current)
          }
          current = current.parentElement
        }
        current = node
        for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
          if (typeof current.getBoundingClientRect !== 'function') return null
          const rect = current.getBoundingClientRect()
          if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return null
          if (rect.height > 72 && rect.height < 620 && rect.width > 240) {
            return { top: rect.top, left: rect.left, width: rect.width }
          }
          current = current.parentElement
        }
        current = node
        for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
          const own = current.getBoundingClientRect()
          if (Number.isFinite(own.top) && Number.isFinite(own.left)) {
            return { top: own.top, left: own.left, width: 0 }
          }
          current = current.parentElement
        }
      } catch (error) {
        return null
      }
      return null
    }

    /** Viewport coordinates, independent of DOM reads so edge cases are testable. */
    function panelGeometry(box, viewport = {}, expanded) {
      const width = Number.isFinite(viewport.width) ? Math.max(120, viewport.width) : 1024
      const height = Number.isFinite(viewport.height) ? Math.max(120, viewport.height) : 800
      const x = Number.isFinite(viewport.left) ? viewport.left : 0
      const y = Number.isFinite(viewport.top) ? viewport.top : 0
      const top = Number.isFinite(box?.top) ? box.top - y : height - 140
      const room = Math.max(0, top - 24)
      const reading = expanded === undefined ? room < 240 : expanded
      const panelWidth = Math.min(reading ? 960 : (box?.width > 0 ? Math.min(860, box.width) : 760), width - 24)
      const maxHeight = reading ? Math.min(height * .84, height - 24) : Math.min(Math.max(160, Math.min(height * .62, room)), height - 24)
      const left = reading ? (width - panelWidth) / 2 : Math.max(12, Math.min((box?.left ?? (width - panelWidth) / 2) - x + ((box?.width ?? panelWidth) - panelWidth) / 2, width - panelWidth - 12))
      return {
        expanded: reading,
        style: {
          position: 'fixed', left: x + left,
          bottom: reading ? Math.max(12, (height - maxHeight) / 2) : Math.max(12, Math.min(height - top + 10, height - maxHeight - 12)),
          width: panelWidth, maxHeight, ...(reading ? { height: maxHeight } : {}),
          // offsetTop matters when the on-screen keyboard moves the visual viewport.
          ...(y ? { top: reading ? y + (height - maxHeight) / 2 : y + height - Math.max(12, Math.min(height - top + 10, height - maxHeight - 12)) - maxHeight, bottom: 'auto' } : {}),
          zIndex: 2147483001, pointerEvents: 'auto',
        },
      }
    }

    function ReadingIcon({ compact = false }) {
      return h('svg', { className: 'pc-icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: compact ? 'M2 6h4V2m8 8h-4v4M6 6 2 2m8 8 4 4' : 'M6 2H2v4m8 8h4v-4M2 2l4 4m8 8-4-4' }))
    }

    function CraftPanel(props) {
      const key = sessionKey(props?.sessionId)
      // Keep all four host selectors unconditional, even when idle or closed.
      const draft = readInputValue(props?.useInput, (state) => state.draft, '')
      const occurrences = readInputValue(props?.useInput, (state) => state.occurrences, [])
      const draftRev = readInputValue(props?.useInput, (state) => state.draftRev, 0)
      const attachmentIds = readInputValue(props?.useInput, (state) => state.attachmentIds, [])
      const inputActions = props?.inputActions
      const snapshot = { draft, draftRev, occurrences, attachmentIds, inputActions }
      composerSnapshots.set(key, snapshot)
      const startForComposer = (request) => startTask(key, { ...request, draftRev: readLiveRev(inputActions, request.draftRev ?? draftRev), attachmentIds })
      const task = getTask(key)
      const view = viewFor(key)
      const shown = task !== null && task.phase !== 'idle'
      const [, setVersion] = useState(0)
      const [copiedId, setCopiedId] = useState(null)
      const [copyError, setCopyError] = useState(false)
      const copyTimer = useRef(null)
      const alive = useRef(true)
      const copySession = useRef(key)
      copySession.current = key
      const [clock, setClock] = useState(Date.now())
      const [showDiffDefault, setShowDiffDefault] = useState(false)
      const [anchor, setAnchor] = useState(null)
      const panelRef = useRef(null)
      const readingButton = useRef(null)
      const focusReturn = useRef(null)
      const collapsed = task?.phase === 'ready' && task?.applied !== null && task?.collapsed === true
      const layout = panelGeometry(anchor?.box, anchor?.viewport, collapsed ? false : view.expanded)
      const expanded = layout.expanded && !collapsed
      const t = (translationKey, params) => componentTranslate(props, translationKey, params)
      const setView = (changes) => patchView(key, changes)
      const dismiss = () => {
        if (getTask(key)?.phase === 'running') abortTask(key)
        else closeTask(key)
        buttonNodes.get(key)?.focus?.()
      }

      useEffect(() => subscribeTask(key, () => setVersion((value) => value + 1)), [key])
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; clearTimeout(copyTimer.current) }
      }, [])
      useEffect(() => { setCopiedId(null); setCopyError(false); clearTimeout(copyTimer.current) }, [key])
      useEffect(() => {
        const update = (value) => setShowDiffDefault(value)
        preferenceListeners.add(update)
        if (showDiffPreference !== null) update(showDiffPreference)
        return () => preferenceListeners.delete(update)
      }, [])
      useEffect(() => {
        if (task?.phase !== 'running') return undefined
        setClock(Date.now())
        const timer = setInterval(() => setClock(Date.now()), 1000)
        timer?.unref?.()
        return () => clearInterval(timer)
      }, [key, task?.phase, task?.startedAt])
      useEffect(() => {
        if (!shown || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.isComposing || event.defaultPrevented) return
          if (event.key === 'Escape') {
            event.preventDefault()
            if (expanded) setView({ expanded: false })
            else dismiss()
          } else if (expanded && event.key === 'Tab' && typeof portalCreate === 'function') {
            // Only inspect descendants of our own ref; never query host DOM.
            const nodes = Array.from(panelRef.current?.getElementsByTagName?.('*') ?? []).filter((node) =>
              node.tabIndex >= 0 && !node.disabled && node.getClientRects().length > 0)
            const current = nodes.indexOf(document.activeElement)
            if (nodes.length === 0) { event.preventDefault(); panelRef.current?.focus?.(); return }
            if (event.shiftKey && current <= 0) { event.preventDefault(); nodes.at(-1).focus() }
            else if (!event.shiftKey && (current === -1 || current === nodes.length - 1)) { event.preventDefault(); nodes[0].focus() }
          }
        }
        const keepFocus = (event) => {
          if (expanded && typeof portalCreate === 'function' && !panelRef.current?.contains?.(event.target)) panelRef.current?.focus?.()
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('focusin', keepFocus)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('focusin', keepFocus)
        }
      }, [key, shown, expanded])
      useEffect(() => {
        if (!shown || !expanded || typeof portalCreate !== 'function') return undefined
        const previous = focusReturn.current ?? (typeof document === 'undefined' ? null : document.activeElement)
        focusReturn.current = null
        panelRef.current?.focus?.()
        return () => {
          if (previous?.isConnected && previous.tagName !== 'BODY') previous.focus?.()
          else if (getTask(key)?.phase === 'ready' && readingButton.current) readingButton.current.focus?.()
          else buttonNodes.get(key)?.focus?.()
        }
      }, [key, shown, expanded])
      useEffect(() => {
        if (!shown) return undefined
        let cancelled = false
        readShowDiffPreference().then((value) => { if (!cancelled && typeof value === 'boolean') setShowDiffDefault(value) }, () => {})
        return () => { cancelled = true }
      }, [shown])

      useMeasureEffect(() => {
        if (!shown) return undefined
        let raf = 0
        const measure = () => {
          raf = 0
          try {
            if (typeof window === 'undefined') return
            const vv = window.visualViewport
            const viewport = { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight, left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0 }
            const node = buttonNodes.get(key)
            const box = node ? composerBoxOf(node) : null
            setAnchor({ box, viewport })
          } catch (error) { setAnchor(null) }
        }
        const schedule = () => {
          if (typeof requestAnimationFrame !== 'function') { measure(); return }
          if (raf === 0) raf = requestAnimationFrame(measure)
        }
        measure()
        if (typeof requestAnimationFrame === 'function') schedule()
        let card = buttonNodes.get(key)
        while (card && card.getAttribute?.('data-composer-card') === null) card = card.parentElement
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        if (card) observer?.observe(card)
        const targets = typeof window === 'undefined' ? [] : [window, window.visualViewport].filter((target) => typeof target?.addEventListener === 'function')
        for (const target of targets) { target.addEventListener('resize', schedule); target.addEventListener('scroll', schedule, true) }
        return () => {
          observer?.disconnect()
          for (const target of targets) { target.removeEventListener('resize', schedule); target.removeEventListener('scroll', schedule, true) }
          if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
        }
      }, [key, shown, task?.phase, draft])

      const mount = (element) => {
        const tree = expanded ? h('div', { className: 'pc-modal-layer', onMouseDown: (event) => { if (event.target === event.currentTarget) setView({ expanded: false }) } }, element) : element
        const portal = portalToBody(tree)
        if (portal !== tree) return portal
        return h(element.type, {
          ...element.props, role: 'region', 'aria-modal': undefined,
          style: { position: 'absolute', left: 0, bottom: 10, width: '100%', maxHeight: layout.style.maxHeight, ...(expanded ? { height: layout.style.maxHeight } : {}), zIndex: layout.style.zIndex, pointerEvents: 'auto' },
        })
      }

      try {
        if (!shown) return null
        const running = task.phase === 'running'
        const preview = running ? (task.fallback ?? (task.candidates.length ? task : null)) : task
        const candidates = preview?.candidates ?? []
        const origin = preview?.originModel ?? task.originModel
        const isDiffOn = (id) => view.diff[id] === undefined ? showDiffDefault : view.diff[id]
        const toggleDiff = (id) => setView({ diff: { ...view.diff, [id]: !isDiffOn(id) } })
        const handleCopy = async (candidate) => {
          try {
            if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(candidate.text)
            if (!alive.current || copySession.current !== key) return
            setCopyError(false); setCopiedId(candidate.id); clearTimeout(copyTimer.current)
            copyTimer.current = setTimeout(() => { if (alive.current && copySession.current === key) setCopiedId(null) }, COPY_RESET_MS)
            copyTimer.current?.unref?.()
          } catch (error) { if (alive.current && copySession.current === key) { setCopiedId(null); setCopyError(true) } }
        }
        const setAnswer = (question, value) => {
          const current = getTask(key)
          if (current === null) return
          const answers = { ...(current.answers ?? {}) }
          const text = String(value ?? '').slice(0, ANSWER_MAX)
          if (text.length === 0) delete answers[question]
          else answers[question] = text
          patchTask(key, { answers })
        }
        const retry = () => {
          const current = getTask(key)
          if (current === null) return
          // A changed composer always starts a fresh run from its live draft.
          if (taskIsStale(current, snapshot)) { startForComposer({ draft, occurrences, draftRev }); return }
          startForComposer({
            draft, occurrences, draftRev,
            resume: true, answers: current.lastAnswers ?? {}, clarificationMode: current.clarificationMode,
            ...(current.lastRevise !== null ? { revise: current.lastRevise } : {}),
          })
        }
        const header = () => h('div', { className: 'pc-panel-head' },
          h('span', { className: 'pc-brand-icon' }, h(SparkIcon, null)),
          h('div', { className: 'pc-heading' },
            h('span', { className: 'pc-panel-title' }, t('panel.title')),
            h('div', { className: 'pc-panel-meta' }, running ? t('panel.running') : panelMetaBits(task, t).join(' · ') || t('panel.subtitle'))),
          h('div', { className: 'pc-head-actions' },
            h('button', { ref: readingButton, type: 'button', className: 'pc-icon-btn', 'aria-label': t(expanded ? 'panel.compact' : 'panel.read'), title: t(expanded ? 'panel.compact' : 'panel.read'), onClick: (event) => { if (!expanded) focusReturn.current = event?.currentTarget ?? null; setView({ expanded: !expanded }) } }, h(ReadingIcon, { compact: expanded })),
            h('button', { type: 'button', className: 'pc-icon-btn', 'aria-label': t(running ? 'panel.cancel' : 'panel.close'), title: t(running ? 'panel.cancel' : 'panel.close'), onClick: dismiss }, '×')))
        const panelProps = {
          className: 'pc-panel', 'data-phase': task.phase, 'data-status': task.status, 'data-panel': 'prompt-craft', 'data-reading': expanded ? 'expanded' : 'compact',
          role: expanded ? 'dialog' : 'region', 'aria-modal': expanded ? 'true' : undefined,
          'aria-label': t('panel.title'), tabIndex: -1, ref: panelRef, style: layout.style,
        }
        if (collapsed) return mount(h('div', { ...panelProps, className: 'pc-panel pc-panel-summary' },
          h('span', { className: 'pc-check', 'aria-hidden': 'true' }, '✓'),
          h('span', { className: 'pc-summary-text' }, t('panel.applied')),
          h('span', { className: 'pc-summary-spacer' }),
          h('button', { type: 'button', className: 'pc-btn', onClick: () => patchTask(key, { collapsed: false }) }, t('panel.expand')),
          h('button', { type: 'button', className: 'pc-btn', onClick: dismiss }, t('panel.close'))))

        const stale = taskIsStale(task, snapshot)
        const renderCard = (candidate) => {
          const diffOn = isDiffOn(candidate.id)
          let tokens = [{ text: candidate.text, added: false }]
          if (diffOn) { try { tokens = diffTokens(origin, candidate.text) } catch (error) { /* Plain text remains readable. */ } }
          return h('article', { className: 'pc-card', key: candidate.id, 'data-candidate': candidate.id },
            h('div', { className: 'pc-card-head' },
              h('span', { className: 'pc-card-label' }, candidate.label),
              h('span', { className: 'pc-char-count' }, t('card.chars', { before: Array.from(origin).length, after: Array.from(candidate.text).length }))),
            h('div', { className: 'pc-card-tools' },
              h('button', { type: 'button', className: 'pc-btn pc-btn-ghost', 'aria-pressed': view.original, onClick: () => setView({ original: !view.original }) }, t(view.original ? 'card.hideOriginal' : 'card.showOriginal')),
              h('button', { type: 'button', className: 'pc-btn pc-btn-ghost', 'aria-pressed': diffOn, onClick: () => toggleDiff(candidate.id) }, t(diffOn ? 'card.compareOff' : 'card.compare'))),
            candidate.warnings.length ? h('div', { className: 'pc-warning', role: 'note' },
              candidate.warnings.map((warning, i) => h('span', { className: 'pc-warn', key: i }, warningText(warning, t))),
              candidate.details.length ? h('details', null, h('summary', null, t('warning.details')), candidate.details.map((detail, i) => h('div', { key: i }, detail))) : null) : null,
            view.original ? h('section', { className: 'pc-original', 'aria-label': t('card.original') }, h('span', { className: 'pc-original-label' }, t('card.original')), h('div', { className: 'pc-card-text' }, origin)) : null,
            diffOn ? h('div', { className: 'pc-card-text pc-diff' }, tokens.map((token, i) => token.added ? h('mark', { className: 'pc-add', key: i }, token.text) : h('span', { key: i }, token.text))) : h('div', { className: 'pc-card-text' }, candidate.text))
        }
        const renderActions = (candidate) => h('div', { className: 'pc-card-actions', key: candidate.id },
          h('div', { className: 'pc-action-group' },
            ...['shorter', 'specific'].map((instruction) => h('button', { type: 'button', className: 'pc-btn pc-btn-ghost', key: instruction, disabled: running || task.status === 'needs_input' || (!stale && instruction === 'specific' && task.specificExhausted), onClick: () => startForComposer({ draft, occurrences, draftRev, revise: { id: candidate.id, text: candidate.text, instruction } }) }, t(`card.${instruction}`)))),
          h('div', { className: 'pc-action-group' },
            h('button', { type: 'button', className: 'pc-btn', onClick: () => handleCopy(candidate) }, copiedId === candidate.id ? t('card.copied') : t('card.copy')),
            h('button', { type: 'button', className: 'pc-btn pc-btn-primary', disabled: running || task.status === 'needs_input', onClick: () => {
              if (stale) startForComposer({ draft, occurrences, draftRev })
              else if (applyCandidate(key, candidate, inputActions, snapshot)) { buttonNodes.get(key)?.focus?.() }
            } }, stale ? t('panel.staleApply') : t('card.apply'))))
        const questionsToken = task.questions
        const questionsOpen = view.questionsClosed !== questionsToken
        const renderQuestions = () => {
          if (running || !task.questions.length) return null
          return h('section', { className: 'pc-questions' },
            h('button', { type: 'button', className: 'pc-questions-toggle', 'aria-label': t('panel.questionsTitle'), 'aria-expanded': questionsOpen, onClick: () => setView({ questionsClosed: questionsOpen ? questionsToken : null }) },
              t('panel.questionsToggle', { count: task.questions.length }), h('span', { 'aria-hidden': 'true' }, questionsOpen ? '⌃' : '⌄')),
            questionsOpen ? h('div', { className: 'pc-questions-content' }, task.questions.map((question, index) => {
              const answer = task.answers?.[question.q] ?? ''
              return h('div', { className: 'pc-question', key: question.q },
                h('label', { className: 'pc-question-text', htmlFor: `pc-answer-${encodeURIComponent(key)}-${index}` }, `${index + 1}. ${question.q}`),
                question.why ? h('p', { className: 'pc-question-why' }, question.why) : null,
                h('div', { className: 'pc-question-row' },
                  question.options.map((option) => h('button', { type: 'button', className: 'pc-chip', key: option, 'aria-pressed': answer === option, 'data-selected': answer === option ? 'true' : undefined, onClick: () => setAnswer(question.q, answer === option ? '' : option) }, option)),
                  h('input', { id: `pc-answer-${encodeURIComponent(key)}-${index}`, type: 'text', className: 'pc-answer-input', value: answer, placeholder: t('panel.answerPlaceholder'), maxLength: ANSWER_MAX, onChange: (event) => setAnswer(question.q, event.target.value) })))
            }), h('div', { className: 'pc-question-actions' },
              h('button', { type: 'button', className: 'pc-btn pc-btn-primary', disabled: !task.questions.every(q => isNonEmptyString(task.answers?.[q.q])), onClick: () => startForComposer({ draft, occurrences, draftRev, resume: true, answers: getTask(key)?.answers ?? {} }) }, t('panel.questionsSubmit')),
              h('button', { type: 'button', className: 'pc-btn pc-btn-ghost', onClick: () => startForComposer({ draft, occurrences, draftRev, resume: true, answers: getTask(key)?.answers ?? {}, clarificationMode: 'proceed' }) }, t('panel.questionsIgnore')))) : null)
        }
        const elapsed = Math.max(0, Math.floor((clock - task.startedAt) / 1000))
        return mount(h('div', panelProps,
          header(),
          h('div', { className: 'pc-panel-body' },
            task.error ? h('div', { className: 'pc-error', role: 'alert' }, task.error, task.phase !== 'error' ? h('button', { type: 'button', className: 'pc-btn', onClick: retry }, t('panel.retry')) : null) : null,
            task.reason && !running ? h('p', { className: task.status === 'blocked' ? 'pc-error' : 'pc-result-reason', role: task.status === 'blocked' ? 'alert' : 'status' }, task.reason) : null,
            task.changes.length && !running ? h('div', { className: 'pc-change-summary' }, h('strong', null, t('panel.changes')), h('ul', null, task.changes.map((change, index) => h('li', { key: index }, change.summary)))) : null,
            task.specificExhausted && !stale && !running ? h('p', { className: 'pc-result-reason' }, t('panel.exhausted')) : null,
            task.phase === 'ready' && !running ? h('button', { type: 'button', className: 'pc-btn pc-btn-ghost', onClick: () => { const q = t('panel.newInformation', { round: Object.keys(task.lastAnswers).length + 1 }); patchTask(key, { status: 'needs_input', specificExhausted: false, questions: [{ q, why: '', options: [] }], answers: { ...task.lastAnswers } }) } }, t('panel.addInformation')) : null,
            task.status === 'blocked' && !running ? h('button', { type: 'button', className: 'pc-btn', onClick: retry }, t('panel.retry')) : null,
            task.partial ? h('p', { className: 'pc-error', role: 'alert' }, t('panel.partial')) : null,
            copyError ? h('p', { className: 'pc-error', role: 'alert' }, t('panel.copyFailed')) : null,
            task.applied && !running ? h('div', { className: 'pc-applied' }, t('panel.applied')) : null,
            task.refused ? h('div', { className: 'pc-refused', role: 'alert' }, t('panel.refused')) : null,
            running && candidates.length ? h('p', { className: 'pc-previous' }, t('panel.previous')) : null,
            candidates.length ? h('div', { className: 'pc-cards' }, candidates.map(renderCard)) : running ? h('div', { className: 'pc-skeleton', 'aria-label': t('panel.running') }, ...[0, 1, 2].map((i) => h('i', { className: 'pc-skeleton-bar', key: i }))) : null,
            renderQuestions()),
          h('div', { className: 'pc-panel-foot' },
            running ? h('div', { className: 'pc-panel-actions' },
              h('div', { className: 'pc-running', role: 'status' }, h(Spinner, null), t('panel.duration', { seconds: elapsed })),
              h('button', { type: 'button', className: 'pc-btn', onClick: () => abortTask(key) }, t('panel.cancel')),
              elapsed >= 10 ? h('span', { className: 'pc-panel-meta' }, t('panel.waiting')) : null) : null,
            task.phase === 'error' ? h('div', { className: 'pc-panel-actions' }, h('button', { type: 'button', className: 'pc-btn pc-btn-primary', onClick: retry }, t('panel.retry')), h('button', { type: 'button', className: 'pc-btn', onClick: dismiss }, t('panel.close'))) : null,
            ...candidates.map(renderActions))))
      } catch (error) {
        return mount(h('div', { className: 'pc-panel', ref: panelRef, 'data-panel': 'prompt-craft', style: layout.style }, h('div', { className: 'pc-panel-head' }, t('panel.title')), h('button', { type: 'button', className: 'pc-btn', onClick: dismiss }, t('panel.close'))))
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
            const { response, payload } = await settingsRequest({
              method: 'GET',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
              signal: controller === null ? undefined : controller.signal,
            })
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
            publishPreferences(payload.values, payload.limits)
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
            const { response, payload } = await settingsRequest({
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
            if (!alive.current) return
            if (response.ok === true && payload !== null && typeof payload === 'object' && payload.ok === true) {
              setValues(normalizeValues(payload.values ?? body))
              publishPreferences(payload.values ?? body, payload.limits)
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
          h('div', { className: 'pc-settings-hero' },
            h('span', { className: 'pc-brand-icon' }, h(SparkIcon, null)),
            h('div', null, h('h2', { className: 'pc-settings-title' }, t('nav')), h('p', { className: 'pc-settings-intro' }, t('settings.intro')))),
          h('section', { className: 'pc-settings-group', 'aria-label': t('settings.preferences.title') },
            h('div', { className: 'pc-field-head' },
              h('h3', { className: 'pc-group-title' }, t('settings.preferences.title')),
              h('span', { className: 'pc-field-count' }, t('settings.preferences.count', { count: values.preferences.length, max: PREFERENCES_MAX }))),
            h('p', { className: 'pc-field-hint' }, t('settings.preferences.hint')),
            h('textarea', {
              className: 'pc-textarea', maxLength: PREFERENCES_MAX, rows: 5,
              'aria-label': t('settings.preferences.title'),
              placeholder: t('settings.preferences.placeholder'), value: values.preferences,
              disabled: status === 'saving',
              onChange: (event) => updateValues({ preferences: event.target.value.slice(0, PREFERENCES_MAX) }),
            })),
          h('section', { className: 'pc-settings-group', 'aria-label': t('settings.preview.title') },
            h('h3', { className: 'pc-group-title' }, t('settings.preview.title')),
            switchRow('context', t('settings.context.title'), t('settings.context.hint'), values.context === true, (next) => updateValues({ context: next })),
            switchRow('showDiff', t('settings.showDiff.title'), t('settings.showDiff.hint'), values.showDiff === true, (next) => updateValues({ showDiff: next }))),
          h('section', { className: 'pc-settings-group', 'aria-label': t('settings.modelGroup.title') },
            h('h3', { className: 'pc-group-title' }, t('settings.modelGroup.title')),
            h('p', { className: 'pc-field-hint' }, t('settings.model.hint')),
            h('label', { className: 'pc-field' },
              h('span', { className: 'pc-field-label' }, t('settings.model.title')),
              h('select', { className: 'pc-select', value: modelValue, 'aria-label': t('settings.model.title'), disabled: status === 'saving', onChange: handleModelChange }, modelOptions))),
          h('div', { className: 'pc-settings-actions' },
            h('button', { type: 'button', className: 'pc-btn pc-btn-primary', disabled: status === 'saving', onClick: handleSave }, t(status === 'saving' ? 'settings.saving' : 'settings.save')),
            h('span', { className: 'pc-status', role: 'status', 'data-kind': statusKind }, statusText)))
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
      try { conversationService = ctx?.conversation ?? ctx?.get?.('conversation') } catch { conversationService = undefined }
      effectOnce(ctx, () => () => {
        for (const task of tasks.values()) task.controller?.abort?.()
        for (const controller of clientRequests) controller.abort()
        for (const key of timers.keys()) clearTimer(key)
        tasks.clear()
        views.clear()
        taskListeners.clear()
        buttonNodes.clear()
        preferenceListeners.clear()
        clientRequests.clear()
        composerSnapshots.clear()
      }, 'prompt-craft: request cleanup')
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
    apply.__internals = {
      buildEnhanceBody,
      composerBoxOf,
      panelGeometry,
      diffTokens,
      planInsertion,
      portalToBody,
      ratioOf,
      prepareDraftImages,
    }

    return {
      inject: ['slots', 'locale', 'conversation'],
      apply,
    }
  },
})
