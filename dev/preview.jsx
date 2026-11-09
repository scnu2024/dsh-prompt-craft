import React, { useState, useSyncExternalStore } from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'

const params = new URLSearchParams(location.search)
const lang = params.get('locale') === 'en' ? 'en' : 'zh'
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const sampleDraft = '帮我整理这次产品评审的讨论，重点是我们已经确认的方案和还没定下来的问题，给团队一个清晰的后续安排。'
const sampleResult = '整理这次产品评审的讨论，先列出已确认的方案，再单独列出尚未决定的问题。\n\n根据讨论中明确提到的负责人和时间，汇总后续安排；缺少的信息请标明需要确认。'
const enDraft = 'Summarise the product review. Focus on confirmed decisions, open questions and the next steps for the team.'
const enResult = 'Summarise the product review, starting with confirmed decisions and then listing open questions.\n\nBring together the next steps, using only the owners and dates stated in the discussion. Flag any missing information for confirmation.'
const longText = Array.from({ length: 24 }, (_, i) => `${i + 1}. 保留会议中已经确认的要求和限制，明确记录当前方案与尚待讨论的问题。\n    整理相关材料时，保持文件名、日期、负责人和原始数字准确，已有结论与后续安排分别表达。`).join('\n\n')
const englishLongText = Array.from({ length: 24 }, (_, i) => `${i + 1}. Preserve the decisions and constraints confirmed in the review.\n    Record the original filenames, dates and owners accurately, then separate open questions from agreed next steps.`).join('\n\n')
const sessions = new Map()
const listeners = new Set()
let session = 'preview-a'
let scenario = params.get('scenario') ?? 'short'
let delay = Number(params.get('delay') ?? 650)
let failNext = false
let settings = { preferences: '', context: true, showDiff: true, provider: '', model: '' }
const calls = []
const undos = new Map()
const draftAttachments = new Map([['preview-file',{id:'preview-file',kind:'file',file:{name:'design-review.pdf'}}]])
function sampleImage(id) {
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII='),x=>x.charCodeAt(0))
  draftAttachments.set(id,{id,kind:'image',file:new File([bytes],'sample.png',{type:'image/png'})})
}
const emit = () => listeners.forEach(listener => listener())
function current() {
  if (!sessions.has(session)) sessions.set(session, { draft: lang === 'zh' ? sampleDraft : enDraft, draftRev: 0, phase: 'idle', occurrences: [], attachmentIds: [] })
  return sessions.get(session)
}
function update(patch) { sessions.set(session, { ...current(), ...patch }); emit() }
function useInput(selector) { return selector(useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, current, current)) }
const inputActions = {
  captureInsertion: () => ({ draftRev: current().draftRev }),
  insertText(text, range) {
    const state = current()
    if (range.draftRev !== state.draftRev) return false
    const history = undos.get(session) ?? []
    history.push(state); undos.set(session, history)
    const delta = text.length - (range.end - range.start)
    const occurrences = state.occurrences.map(occurrence => ({ ...occurrence, offset: occurrence.offset >= range.end ? occurrence.offset + delta : occurrence.offset }))
    update({ draft: state.draft.slice(0, range.start) + text + state.draft.slice(range.end), occurrences, draftRev: state.draftRev + 1 })
    return true
  },
}
function undo() { const previous = undos.get(session)?.pop(); if (previous) update({ ...previous, draftRev: current().draftRev + 1 }) }
function setScenario(next) {
  scenario = next
  let draft = lang === 'zh' ? sampleDraft : enDraft
  if (next === 'long') draft = lang === 'zh' ? longText : englishLongText
  if (next === 'links') draft += '\nhttps://example.com/review/' + 'very-long-path-'.repeat(45)
  if (next === 'images' || next === 'image-only') {
    sampleImage('preview-image-a');sampleImage('preview-image-b')
    update({draft:next==='image-only'?'':draft,draftRev:current().draftRev+1,occurrences:[],attachmentIds:['preview-image-a','preview-image-b']})
  } else if (next === 'attachments') {
    draft += '\n\uFFFC'
    update({ draft, draftRev: current().draftRev + 1, occurrences: [{ offset: draft.length - 1, length: 17, clipboardText: 'design-review.pdf' }], attachmentIds: ['preview-file'] })
  } else update({ draft, draftRev: current().draftRev + 1, occurrences: [], attachmentIds: [] })
}
setScenario(scenario)
window.fetch = async (url, options = {}) => {
  const path = String(url).split('?')[0]
  const body = options.body ? JSON.parse(options.body) : null
  calls.push({ url: String(url), body })
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  if (path === '/api/prompt-craft/settings') {
    if (options.method === 'POST') settings = { ...settings, ...body }
    return response({ ok: true, values: settings, capabilities:{draftImages:true}, catalog: { providers: [{ id: 'preview', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] }] }, limits: { timeoutMs: 60000, maxDraftChars: 6000 } })
  }
  if (path !== '/api/prompt-craft/enhance') return response({ ok: false, message: 'Preview route unavailable' }, 404)
  const activeScenario = scenario
  const shouldFail = failNext || activeScenario === 'error'
  failNext = false
  await new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { options.signal?.removeEventListener('abort', onAbort); resolve() }, activeScenario === 'slow' ? 30000 : delay)
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
  if (shouldFail) return response({ ok: false, message: lang === 'zh' ? '本次生成未完成，请稍后重试。' : 'Generation did not complete. Please retry.' }, 503)
  let text = lang === 'zh' ? sampleResult : enResult
  if (activeScenario === 'long' || activeScenario === 'links' || activeScenario === 'attachments') text = body.draft + (lang === 'zh' ? '\n\n按上述顺序整理，并保留材料中的原始信息。' : '\n\nFollow this order and preserve the information in the source.')
  if (body.revise?.instruction === 'shorter') text = lang === 'zh' ? '整理产品评审中已确认的方案、待定问题和后续安排，保留讨论中明确的负责人及时间。' : 'Summarise confirmed decisions, open questions and agreed next steps from the product review.'
  if (body.revise?.instruction === 'specific') text = body.revise.text + (lang === 'zh' ? '\n\n将已确定的内容和需要确认的内容分别列出。' : '\n\nSeparate confirmed information from items requiring clarification.')
  if (activeScenario === 'unchanged') text = body.draft
  const needsInput = ['questions','image-only'].includes(activeScenario) && !body.answers?.length && body.clarificationMode !== 'proceed'
  const summary = lang === 'zh' ? '区分已确认事项和待确认事项' : 'Separates confirmed and open items'
  const exhausted = body.revise?.instruction === 'specific' && !body.answers?.length && body.revisionContext?.improvements?.includes(summary)
  if (exhausted) text = body.revise.text
  return response({ ok: true, protocolVersion: 2, status: needsInput ? 'needs_input' : exhausted || activeScenario === 'unchanged' ? 'unchanged' : 'ready',
    reason: needsInput ? (lang === 'zh' ? '先确认受众和呈现方式，再组织成稿。' : 'Confirm the audience and format before crafting.') : exhausted ? (lang === 'zh' ? '当前版本已充分明确，可补充新信息后继续。' : 'This version is already specific. Add new information to continue.') : '',
    changes: needsInput || exhausted ? [] : [{id:'i1',summary}],
    questions: needsInput ? [
      { q: lang === 'zh' ? '这份整理主要给谁看？' : 'Who will read this summary?', why: lang === 'zh' ? '便于确定表达的详细程度。' : 'This helps set the level of detail.', options: lang === 'zh' ? ['项目团队', '评审参与者'] : ['Project team', 'Review participants'] },
      { q: lang === 'zh' ? '你希望后续安排怎样呈现？' : 'How should the next steps be presented?', why: '', options: lang === 'zh' ? ['简短清单', '按负责人分组'] : ['Short checklist', 'Group by owner'] },
    ] : [], candidates: needsInput ? [] : [{ id: 'clear', label: lang === 'zh' ? '打磨后的提示词' : 'Crafted prompt', text, warnings: activeScenario === 'warnings' ? ['invented:2'] : [], details: activeScenario === 'warnings' ? ['design-review.pdf', '2026-11-09'] : [] }],
    meta: { model: 'deepseek-flash', imagesUsed:body.images?.length??0, elapsedMs: delay, unchanged: exhausted || activeScenario === 'unchanged', specificExhausted: exhausted } })
}

const slots = new Map()
const dictionaries = new Map()
const cleanups = []
window.__ModuleLoader__ = { load(definition) {
  const plugin = definition.factory(name => { if (name === 'react') return React; if (name === 'react-dom') return ReactDOM; throw new Error(name) })
  plugin.apply({
    conversation:{resolveDraftAttachments:ids=>ids.map(id=>draftAttachments.get(id)).filter(Boolean)},
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup },
    slots: { inject: (_name, callback) => callback(), register(options, component) { slots.set(options.name, component); return () => slots.delete(options.name) } },
    locale: { register(namespace, tables) { dictionaries.set(namespace, tables); return () => dictionaries.delete(namespace) }, bind: namespace => key => dictionaries.get(namespace)?.[lang]?.[key] ?? key },
  })
} }
await import('../client.js')
const CraftButton = slots.get('conversation.input.right')
const CraftPanel = slots.get('conversation.input.overlay')
const CraftSettings = slots.get('settings.section')
function App() {
  const state = useInput(value => value)
  const [settingsOpen, setSettingsOpen] = useState(params.get('page') === 'settings')
  const [theme, setTheme] = useState(document.documentElement.dataset.theme)
  const [activeScenario, setActiveScenario] = useState(scenario)
  const [hero, setHero] = useState(params.get('layout') === 'hero')
  const [sessionKey, setSessionKey] = useState(session)
  window.preview = {
    calls, inputActions, setDraft: draft => update({ draft, draftRev: current().draftRev + 1 }),
    setDelay: value => { delay = value }, failNext: () => { failNext = true },
    setScenario: value => { setScenario(value); setActiveScenario(value) },
    switchSession(value) { session = value; current(); setSessionKey(value); emit() },
    setHero, undo, settings: setSettingsOpen,
    replaceImage(id) { sampleImage(id);emit() },
    reorderImages() { update({attachmentIds:[...current().attachmentIds].reverse()}) },
    setTheme(value) { document.documentElement.dataset.theme = value; setTheme(value) },
    state: () => current(),
  }
  const props = { sessionId: sessionKey, useInput, inputActions }
  return <>
    <header className="lab-bar"><div className="lab-brand">Prompt craft <span className="lab-badge">UI LAB</span></div>
      <select aria-label="预览场景" value={activeScenario} onChange={event => window.preview.setScenario(event.target.value)}>
        {Object.entries({ short: '简短提示词', long: '长文本', links: '长链接', attachments: '附件', images:'图片与文字', 'image-only':'仅图片', questions: '补充问题', warnings: '警告详情', unchanged: '原文保留', error: '生成失败', slow: '持续生成' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button onClick={() => window.preview.setTheme(theme === 'light' ? 'dark' : 'light')}>切换主题</button>
      <button onClick={() => setSettingsOpen(!settingsOpen)}>{settingsOpen ? '返回会话' : '设置'}</button>
      <button onClick={() => setHero(!hero)}>切换布局</button>
    </header>
    <div className={'lab-shell' + (hero ? ' lab-hero' : '')}>
      <aside className="lab-sidebar"><strong>DeepSeek Harness</strong><div className="lab-nav">＋ 新建会话</div><div className="lab-nav active">产品评审整理</div><div className="lab-nav">本周工作计划</div><div className="lab-nav">课程汇报准备</div></aside>
      <main className="lab-content">
        {settingsOpen ? <div className="lab-settings"><CraftSettings /></div> : <>
          <div className="lab-chat"><div className="lab-chat-head">产品评审整理 / DeepSeek Flash</div><div className="lab-user">这次评审的记录已经整理好了，我们一起看看下一步。</div><div className="lab-assistant"><strong>把讨论变成清晰的下一步</strong><p>可以先梳理已经确认的内容，再整理还需要讨论的问题。将评审记录中的负责人和时间放在一起，团队就能更方便地跟进。</p></div></div>
          <div className="lab-composer-dock"><div className="lab-composer" data-composer-card="">
            {state.attachmentIds.map(id=><span key={id} className="lab-chip">▧ {draftAttachments.get(id)?.file.name??id}</span>)}
            <textarea aria-label="消息草稿" className="lab-draft" value={state.draft} onChange={event => update({ draft: event.target.value, draftRev: state.draftRev + 1 })} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); undo() } }} />
            <div className="lab-tools"><span className="lab-tool">＋</span><span className="lab-tool">DeepSeek Flash</span><span className="lab-spacer" /><CraftButton {...props} /><span className="lab-send">↑</span></div>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0 }}><CraftPanel {...props} /></div>
          </div><div className="lab-footnote">本地界面预览 · 使用固定示例结果</div></div>
        </>}
      </main>
    </div>
  </>
}
createRoot(document.getElementById('root')).render(<App />)
window.addEventListener('pagehide', () => cleanups.reverse().forEach(cleanup => cleanup()))
