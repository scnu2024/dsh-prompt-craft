// Tests for the prompt-craft browser half (client.js).
//
// The browser module table, React, the composer and the Host's fetch routes are
// all stubbed here: a tiny hook runtime mounts the registered components, runs
// their effects, and re-renders when a hook setter or the session task store
// fires. That is enough to drive the real click -> request -> panel -> apply
// flow end to end without a browser.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

let definition = null
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
}

// ---------------------------------------------------------------------------
// Minimal React runtime
// ---------------------------------------------------------------------------

let currentInstance = null
let hookCursor = 0

function createElement(type, props, ...children) {
  const nextProps = { ...(props ?? {}) }
  if (children.length === 1) nextProps.children = children[0]
  else if (children.length > 1) nextProps.children = children
  return { type, props: nextProps }
}

function depsChanged(previous, next) {
  if (!Array.isArray(next) || !Array.isArray(previous)) return true
  if (previous.length !== next.length) return true
  return next.some((value, index) => !Object.is(value, previous[index]))
}

const React = {
  createElement,
  useState(initial) {
    const instance = currentInstance
    const index = hookCursor
    hookCursor += 1
    if (instance.hooks[index] === undefined) {
      instance.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const cell = instance.hooks[index]
    const setValue = (next) => {
      const value = typeof next === 'function' ? next(cell.value) : next
      if (Object.is(value, cell.value)) return
      cell.value = value
      instance.dirty = true
    }
    return [cell.value, setValue]
  },
  useEffect(effect, dependencies) {
    const instance = currentInstance
    const index = hookCursor
    hookCursor += 1
    if (instance.hooks[index] === undefined) instance.hooks[index] = {}
    const cell = instance.hooks[index]
    if (cell.mounted !== true || depsChanged(cell.dependencies, dependencies)) {
      cell.dependencies = Array.isArray(dependencies) ? dependencies.slice() : undefined
      cell.mounted = true
      cell.pendingEffect = effect
    }
  },
  useRef(initial) {
    const instance = currentInstance
    const index = hookCursor
    hookCursor += 1
    if (instance.hooks[index] === undefined) instance.hooks[index] = { ref: { current: initial } }
    return instance.hooks[index].ref
  },
  useMemo(factory, dependencies) {
    const instance = currentInstance
    const index = hookCursor
    hookCursor += 1
    const cell = instance.hooks[index]
    if (cell === undefined || cell.mounted !== true || depsChanged(cell.dependencies, dependencies)) {
      instance.hooks[index] = {
        value: factory(),
        dependencies: Array.isArray(dependencies) ? dependencies.slice() : undefined,
        mounted: true,
      }
    }
    return instance.hooks[index].value
  },
  useCallback(callback, dependencies) {
    return React.useMemo(() => callback, dependencies)
  },
}

function createRoot(component, props) {
  return { component, props, hooks: [], dirty: true, mounted: false, tree: null }
}

function renderOnce(instance) {
  currentInstance = instance
  hookCursor = 0
  const tree = instance.component(instance.props)
  instance.tree = tree
  instance.dirty = false
  const jobs = []
  for (const cell of instance.hooks) {
    if (cell !== undefined && typeof cell.pendingEffect === 'function') {
      jobs.push([cell, cell.pendingEffect])
      cell.pendingEffect = null
    }
  }
  for (const [cell, effect] of jobs) {
    if (typeof cell.cleanup === 'function') cell.cleanup()
    const cleanup = effect()
    cell.cleanup = typeof cleanup === 'function' ? cleanup : null
  }
  instance.mounted = true
  return tree
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function settle(instance, rounds = 40) {
  let tree = null
  for (let round = 0; round < rounds; round += 1) {
    tree = renderOnce(instance)
    await flushTasks()
    if (!instance.dirty) return tree
  }
  throw new Error('component did not settle')
}

function unmount(instance) {
  for (const cell of instance.hooks) {
    if (cell !== undefined && typeof cell.cleanup === 'function') cell.cleanup()
  }
  instance.hooks.length = 0
}

// ---------------------------------------------------------------------------
// Tree helpers (host elements only: the code under test calls its own
// component functions directly, exactly like the reference implementation)
// ---------------------------------------------------------------------------

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') return
  visit(node)
  walk(node.props?.children, visit)
}

function findNodes(tree, predicate) {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

function textContent(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'object') return textContent(node.props?.children)
  return ''
}

function allText(tree) {
  const values = []
  walk(tree, (node) => {
    const text = textContent(node)
    if (text.length > 0) values.push(text)
  })
  return values
}

function textIncludes(tree, needle) {
  return allText(tree).some((text) => text.includes(needle))
}

function findButton(tree, label) {
  return findNodes(tree, (node) => (
    node.type === 'button'
    && (textContent(node) === label
      || node.props?.['aria-label'] === label
      || node.props?.title === label)
  ))[0] ?? null
}

function click(node) {
  assert.ok(node !== null && node !== undefined, 'expected a clickable node')
  assert.equal(typeof node.props.onClick, 'function', `node ${String(node.type)} has no onClick`)
  node.props.onClick({ preventDefault() {}, stopPropagation() {} })
}

// ---------------------------------------------------------------------------
// Fake Host routes
// ---------------------------------------------------------------------------

const CATALOG = {
  providers: [
    {
      id: 'deepseek-account',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }],
    },
    {
      id: 'local',
      name: 'Local',
      models: [{ id: 'qwen', name: 'Qwen' }],
    },
  ],
}

const SUCCESS_PAYLOAD = {
  ok: true,
  questions: [
    {
      q: 'Which file is the target?',
      why: 'The draft only says “the report”.',
      options: ['report.md', 'slides.pdf'],
    },
  ],
  candidates: [
    {
      id: 'clear',
      label: 'Clear',
      text: 'Summarise report.md in five bullets.',
      warnings: ['invented:2'],
    },
  ],
  meta: {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    elapsedMs: 4200,
    context: true,
    repaired: false,
  },
}

function settingsValues(overrides = {}) {
  return { preferences: '', context: true, showDiff: false, provider: '', model: '', ...overrides }
}

function defaultRouter(request) {
  if (request.url === '/api/prompt-craft/enhance') {
    return { status: 200, body: SUCCESS_PAYLOAD }
  }
  if (request.url === '/api/prompt-craft/settings') {
    if (request.method === 'POST') {
      return { status: 200, body: { ok: true, values: settingsValues(request.body ?? {}) } }
    }
    return { status: 200, body: { ok: true, values: settingsValues(), catalog: CATALOG } }
  }
  return { status: 404, body: { ok: false, message: 'not found' } }
}

const fetchCalls = []
let activeRouter = null

function abortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

globalThis.fetch = async (url, options = {}) => {
  const request = {
    url: String(url),
    method: String(options.method ?? 'GET').toUpperCase(),
    options,
    body: typeof options.body === 'string' ? JSON.parse(options.body) : null,
  }
  fetchCalls.push(request)
  const signal = options.signal ?? null
  if (signal !== null && signal.aborted) throw abortError()
  const router = activeRouter ?? defaultRouter
  const result = await router(request)
  if (signal !== null && signal.aborted) throw abortError()
  const status = Number.isFinite(result?.status) ? result.status : 200
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (result === undefined ? null : (result.body ?? null)),
    headers: { get: () => null },
  }
}

function enhanceCalls() {
  return fetchCalls.filter((call) => call.url === '/api/prompt-craft/enhance')
}

function settingsCalls() {
  return fetchCalls.filter((call) => call.url === '/api/prompt-craft/settings')
}

// ---------------------------------------------------------------------------
// Register the plugin exactly the way the Client does
// ---------------------------------------------------------------------------

await import('../client.js')

assert.ok(definition !== null, 'client.js did not call window.__ModuleLoader__.load')

const requestedModules = []
const plugin = definition.factory((name) => {
  requestedModules.push(name)
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
})

const localeRegistrations = []
const localeTables = new Map()
const locale = {
  register(namespace, messages) {
    localeRegistrations.push([namespace, messages])
    localeTables.set(namespace, messages)
    return () => {}
  },
  bind(namespace) {
    return (key) => {
      const tables = localeTables.get(namespace)
      if (tables === undefined || tables.en === undefined) return key
      return Object.prototype.hasOwnProperty.call(tables.en, key) ? tables.en[key] : key
    }
  },
}

const slotRegistrations = []
const ctx = {
  locale,
  slots: {
    inject(name, callback) {
      return callback()
    },
    register(options, component) {
      slotRegistrations.push({ options, component })
      return () => {}
    },
  },
  effect(callback) {
    return callback()
  },
}

plugin.apply(ctx)

const dictionaries = localeTables.get('prompt-craft')
const EN = dictionaries.en
const ZH = dictionaries.zh
const internals = plugin.apply.__internals

function slotEntry(name) {
  const registration = slotRegistrations.find((entry) => entry.options.name === name)
  assert.ok(registration !== undefined, `slot ${name} was not registered`)
  return registration
}

const Button = slotEntry('conversation.input.right').component
const Panel = slotEntry('shell.overlay').component
const Settings = slotEntry('settings.section').component

// ---------------------------------------------------------------------------
// Composer fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides = {}) {
  const state = {
    draft: '',
    draftRev: 0,
    phase: 'idle',
    occurrences: [],
    attachmentIds: [],
    ...overrides,
  }
  return { state, useInput: (selector) => selector(state) }
}

function makeInsertActions(options = {}) {
  const calls = []
  let revision = Number.isFinite(options.startRev) ? options.startRev : 5
  const accept = typeof options.accept === 'function' ? options.accept : () => true
  return {
    calls,
    get revision() {
      return revision
    },
    insertText(text, span) {
      calls.push({ text, start: span?.start, end: span?.end, draftRev: span?.draftRev })
      revision += 1
      return accept(calls.length, text, span)
    },
    captureInsertion() {
      return { draftRev: revision }
    },
  }
}

function composerProps(sessionId, input, inputActions = makeInsertActions()) {
  return { sessionId, useInput: input.useInput, inputActions }
}

function resetRoutes(router = defaultRouter) {
  activeRouter = router
  fetchCalls.length = 0
  return router
}

/**
 * Mount the toolbar button, click it once, and wait for the task to settle.
 * Returns both roots so later clicks can be driven through the real handlers.
 */
async function craft(sessionId, input, inputActions, router = defaultRouter) {
  resetRoutes(router)
  const props = composerProps(sessionId, input, inputActions)
  const buttonRoot = createRoot(Button, props)
  const buttonTree = await settle(buttonRoot)
  assert.ok(buttonTree !== null, 'button should render for a non-empty draft')
  click(buttonTree)
  const runningTree = renderOnce(buttonRoot)
  assert.equal(runningTree.props['data-state'], 'running')
  assert.equal(runningTree.props['aria-label'], EN['button.running'])
  await settle(buttonRoot)
  const panelRoot = createRoot(Panel, props)
  await settle(panelRoot)
  return {
    props,
    buttonRoot,
    panelRoot,
    // Getters: later settles re-render the same roots, so assertions must read
    // the current tree rather than the snapshot taken at mount time.
    get buttonTree() {
      return buttonRoot.tree
    },
    get panelTree() {
      return panelRoot.tree
    },
  }
}

// ---------------------------------------------------------------------------
// Module shape, registrations, locale
// ---------------------------------------------------------------------------

test('the client module registers the expected bundle id and module shape', () => {
  assert.equal(definition.id, 'dsh-prompt-craft')
  assert.equal(typeof definition.factory, 'function')
  assert.deepEqual(requestedModules, ['react'])
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')

  const fresh = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })
  assert.deepEqual(fresh.inject, ['slots', 'locale'])
  assert.equal(typeof fresh.apply, 'function')
})

test('apply registers one bilingual locale table and the three contract slots', () => {
  assert.equal(localeRegistrations.length, 1)
  const [namespace, messages] = localeRegistrations[0]
  assert.equal(namespace, 'prompt-craft')
  assert.equal(typeof messages.en, 'object')
  assert.equal(typeof messages.zh, 'object')

  assert.equal(slotRegistrations.length, 3)

  const button = slotEntry('conversation.input.right')
  assert.equal(button.options.id, 'prompt-craft')
  assert.equal(button.options.order, -100)
  assert.equal(typeof button.component, 'function')

  const panel = slotEntry('shell.overlay')
  assert.equal(panel.options.id, 'prompt-craft-panel')
  assert.equal(panel.options.order, 2)
  assert.equal(typeof panel.component, 'function')

  const settings = slotEntry('settings.section')
  assert.equal(settings.options.id, 'prompt-craft')
  assert.equal(settings.options.order, 50)
  assert.equal(typeof settings.options.label, 'function')
  assert.equal(settings.options.label(), EN.nav)
  assert.equal(typeof settings.component, 'function')

  assert.deepEqual(Object.keys(internals).sort(), ['buildEnhanceBody', 'diffTokens', 'planInsertion', 'ratioOf'])
})

test('every visible string exists in both the zh and en tables', () => {
  const enKeys = Object.keys(EN).sort()
  const zhKeys = Object.keys(ZH).sort()
  assert.deepEqual(zhKeys, enKeys)
  for (const key of enKeys) {
    assert.equal(typeof EN[key], 'string', `en.${key}`)
    assert.equal(typeof ZH[key], 'string', `zh.${key}`)
    assert.ok(EN[key].length > 0, `en.${key} is empty`)
    assert.ok(ZH[key].length > 0, `zh.${key} is empty`)
  }
  assert.equal(ZH.nav, '提示词打磨')
  assert.equal(EN['card.apply'], 'Use this version')

  // Chinese copy must live inside the zh table only; the wire attachment
  // marker is escaped, so any CJK found elsewhere is a hard-coded string.
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const zhStart = source.indexOf('const zh = {')
  const cssStart = source.indexOf('const css = `')
  assert.ok(zhStart > 0, 'zh table not found')
  assert.ok(cssStart > zhStart, 'css block not found after the zh table')
  const outside = source.slice(0, zhStart) + source.slice(cssStart)
  assert.equal(/[\u3400-\u9fff\uf900-\ufaff]/u.test(outside), false, 'CJK copy outside the zh locale table')
})

test('the bundle is dependency-free, JSX-free, and coloured from theme tokens only', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(source.includes('@deepseek-ai/'), false)
  assert.equal(source.includes('document.body'), false)
  assert.equal(source.includes('querySelector'), false)
  const requires = [...source.matchAll(/require\('([^']+)'\)/gu)].map((match) => match[1])
  assert.deepEqual(requires, ['react'])

  const marker = 'const css = `'
  const cssStart = source.indexOf(marker)
  const cssEnd = source.indexOf('`', cssStart + marker.length)
  assert.ok(cssStart > 0 && cssEnd > cssStart, 'stylesheet not found')
  const stylesheet = source.slice(cssStart + marker.length, cssEnd)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/u.test(stylesheet), false, 'hard-coded hex colour')
  assert.equal(/\b(?:rgb|rgba|hsl|hsla)\(/u.test(stylesheet), false, 'hard-coded functional colour')
  assert.ok(stylesheet.includes('var(--dsw-alias-'), 'stylesheet does not use theme tokens')
  assert.ok(stylesheet.includes('40vh'), 'panel height cap missing')
  assert.ok(stylesheet.includes('12em'), 'card text height cap missing')
  assert.ok(stylesheet.includes('color-mix('), 'added-fragment highlight missing')
  assert.ok(stylesheet.includes('.pc-'), 'class prefix missing')
})

test('apply installs exactly one pc- stylesheet through ctx.effect and removes it', () => {
  const created = []
  const appended = []
  const previousDocument = globalThis.document
  globalThis.document = {
    createElement(tag) {
      const node = {
        tag,
        attributes: {},
        textContent: '',
        setAttribute(name, value) {
          node.attributes[name] = value
        },
        remove() {
          const index = appended.indexOf(node)
          if (index >= 0) appended.splice(index, 1)
        },
      }
      created.push(node)
      return node
    },
    head: {
      appendChild(node) {
        appended.push(node)
      },
    },
  }
  try {
    const freshPlugin = definition.factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected module request: ${name}`)
    })
    const cleanups = []
    freshPlugin.apply({
      locale: {
        register: () => () => {},
        bind: () => (key) => EN[key] ?? key,
      },
      slots: {
        inject: (name, callback) => callback(),
        register: () => () => {},
      },
      effect(callback) {
        const cleanup = callback()
        cleanups.push(cleanup)
        return cleanup
      },
    })
    assert.equal(created.length, 1)
    assert.equal(created[0].tag, 'style')
    assert.equal(appended.length, 1)
    assert.ok(created[0].textContent.includes('.pc-panel'))
    assert.ok(created[0].textContent.includes('var(--dsw-alias-bg-base)'))
    for (const cleanup of cleanups) {
      if (typeof cleanup === 'function') cleanup()
    }
    assert.equal(appended.length, 0, 'stylesheet should be removed with the plugin')
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

// ---------------------------------------------------------------------------
// Pure functions (CONTRACT §2 internals)
// ---------------------------------------------------------------------------

test('planInsertion replaces whole drafts without chips and preserves chips otherwise', () => {
  const { planInsertion } = internals

  assert.deepEqual(planInsertion('hello world', []), [{ start: 0, end: 11 }])
  assert.deepEqual(planInsertion('', []), [])

  // Detect projection: the chip is one placeholder at index 5.
  const detect = 'tidy \uFFFC up'
  const occurrences = [{ offset: 5, length: 10, clipboardText: 'slides.pdf' }]
  const segments = planInsertion(detect, occurrences)
  assert.deepEqual(segments, [{ start: 0, end: 5 }, { start: 6, end: 9 }])
  for (const segment of segments) {
    assert.equal(segment.start <= 5 && segment.end > 5, false, 'a segment covers the chip placeholder')
  }

  // Clipboard projection of the same draft yields the same detect spans.
  assert.deepEqual(planInsertion('tidy slides.pdf up', occurrences), segments)

  // Chip-only draft: a collapsed insertion point after the chip, never over it.
  assert.deepEqual(
    planInsertion('\uFFFC', [{ offset: 0, length: 10, clipboardText: 'slides.pdf' }]),
    [{ start: 1, end: 1 }],
  )
})

test('diffTokens marks exactly the added fragments and covers the candidate', () => {
  const { diffTokens } = internals

  const latin = diffTokens('Write a summary', 'Write a concise summary')
  assert.equal(latin.map((token) => token.text).join(''), 'Write a concise summary')
  assert.equal(latin.filter((token) => token.added).map((token) => token.text).join(''), 'concise ')
  assert.equal(latin.filter((token) => token.added).some((token) => token.text.includes('Write')), false)

  const cjk = diffTokens('写一个总结', '写一个简洁的总结')
  assert.equal(cjk.map((token) => token.text).join(''), '写一个简洁的总结')
  assert.equal(cjk.filter((token) => token.added).map((token) => token.text).join(''), '简洁的')

  assert.deepEqual(diffTokens('same', 'same'), [{ text: 'same', added: false }])
  assert.deepEqual(diffTokens('', 'fresh'), [{ text: 'fresh', added: true }])
  assert.deepEqual(diffTokens('gone', ''), [])
})

test('ratioOf and buildEnhanceBody follow the frozen request shape', () => {
  const { ratioOf, buildEnhanceBody } = internals

  assert.equal(ratioOf('abcd', 'abcdefghij'), 2.5)
  assert.equal(ratioOf('', 'anything'), 1)
  assert.equal(ratioOf('same', 'same'), 1)

  assert.deepEqual(buildEnhanceBody({ draft: 'hi' }), { draft: 'hi' })

  assert.deepEqual(buildEnhanceBody({
    sessionId: 'session-x',
    draft: 'please tidy',
    attachments: [{ index: 1, name: 'slides.pdf', kind: 'file' }],
    answers: { 'Which file?': 'report.md' },
    revise: { id: 'terse', text: 'old text', instruction: 'specific' },
  }), {
    draft: 'please tidy',
    sessionId: 'session-x',
    attachments: [{ index: 1, name: 'slides.pdf', kind: 'file' }],
    answers: [{ q: 'Which file?', a: 'report.md' }],
    revise: { id: 'terse', text: 'old text', instruction: 'specific' },
  })

  // Empty answers, unknown instruction and invalid revise are omitted/normalised.
  assert.deepEqual(buildEnhanceBody({ draft: 'x', answers: { q: '  ' } }), { draft: 'x' })
  assert.deepEqual(
    buildEnhanceBody({ draft: 'x', revise: { id: 'a', text: 't', instruction: 'whatever' } }).revise,
    { id: 'a', text: 't', instruction: 'shorter' },
  )
  assert.equal(buildEnhanceBody({ draft: 'x', revise: { id: '', text: 't' } }).revise, undefined)
})

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

test('the composer button hides for empty/whitespace drafts and reports its state', async () => {
  for (const draft of ['', '   \n\t ']) {
    const input = makeInput({ draft })
    const root = createRoot(Button, composerProps('session-hidden', input))
    assert.equal(await settle(root), null, `expected no button for draft ${JSON.stringify(draft)}`)
    unmount(root)
  }

  const input = makeInput({ draft: 'write a summary' })
  const root = createRoot(Button, composerProps('session-idle', input))
  const tree = await settle(root)
  assert.equal(tree.type, 'button')
  assert.equal(tree.props['data-state'], 'idle')
  assert.equal(tree.props['aria-label'], EN['button.idle'])
  assert.equal(tree.props.title, EN['button.idle'])
  unmount(root)

  const panelRoot = createRoot(Panel, composerProps('session-idle', input))
  assert.equal(await settle(panelRoot), null, 'the dock panel must be empty when idle')
  unmount(panelRoot)
})

// ---------------------------------------------------------------------------
// Enhance flow: request shape, panel content, questions
// ---------------------------------------------------------------------------

test('a click sends the expected request and the panel previews the candidate', async () => {
  const sessionId = 'session-enhance'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 3 })
  const flow = await craft(sessionId, input, makeInsertActions())

  const calls = enhanceCalls()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, { draft: 'Summarise the weekly report', sessionId })

  const panel = flow.panelTree
  assert.equal(panel.type, 'div')
  assert.equal(panel.props['data-phase'], 'ready')
  assert.equal(textIncludes(panel, EN['panel.title']), true)
  assert.equal(textIncludes(panel, 'deepseek-flash'), true)
  assert.equal(textIncludes(panel, EN['panel.elapsed'].replace('{seconds}', '4.2')), true)

  const cards = findNodes(panel, (node) => node.type === 'article')
  assert.equal(cards.length, 1)
  assert.equal(textContent(cards[0]), [
    'Clear',
    EN['card.ratio'].replace('{ratio}', '1.3'),
    EN['warning.invented'].replace('{count}', '2'),
    'Summarise report.md in five bullets.',
    EN['card.compare'],
    EN['card.apply'],
    EN['card.shorter'],
    EN['card.specific'],
    EN['card.copy'],
  ].join(''))
  assert.equal(allText(panel).some((text) => /^\d+\.\dx$/u.test(text)), true, 'length ratio badge missing')

  // Questions: text, why and option chips are all rendered.
  assert.equal(textIncludes(panel, EN['panel.questionsTitle']), true)
  assert.equal(textIncludes(panel, 'Which file is the target?'), true)
  assert.equal(textIncludes(panel, 'The draft only says'), true)
  assert.ok(findButton(panel, 'report.md'))
  assert.ok(findButton(panel, 'slides.pdf'))
  assert.ok(findNodes(panel, (node) => node.type === 'input').some((node) => node.props.className === 'pc-answer-input'))

  // Buttons of the contract are present, and the toolbar button shows ✓.
  for (const label of [EN['card.apply'], EN['card.shorter'], EN['card.specific'], EN['card.copy'], EN['card.compare']]) {
    assert.ok(findButton(panel, label), `missing button ${label}`)
  }
  assert.equal(flow.buttonTree.props['data-state'], 'ready')
  assert.equal(flow.buttonTree.props['aria-label'], EN['button.done'])

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('answers are sent back with the regenerate request and ignore clears the questions', async () => {
  const sessionId = 'session-answers'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const flow = await craft(sessionId, input, makeInsertActions())

  // Pick an option chip, then add free text to the same question.
  click(findButton(flow.panelTree, 'slides.pdf'))
  await settle(flow.panelRoot)
  const answerInput = findNodes(flow.panelTree, (node) => node.type === 'input')
    .find((node) => node.props.className === 'pc-answer-input')
  assert.ok(answerInput)
  assert.equal(answerInput.props.value, 'slides.pdf')
  answerInput.props.onChange({ target: { value: 'slides.pdf, page 3' } })
  await settle(flow.panelRoot)

  fetchCalls.length = 0
  click(findButton(flow.panelTree, EN['panel.questionsSubmit']))
  await settle(flow.panelRoot)

  const calls = enhanceCalls()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body.answers, [{ q: 'Which file is the target?', a: 'slides.pdf, page 3' }])

  // The regenerated panel still shows the questions; ignore removes them.
  assert.ok(findButton(flow.panelTree, EN['panel.questionsIgnore']))
  click(findButton(flow.panelTree, EN['panel.questionsIgnore']))
  await settle(flow.panelRoot)
  assert.equal(findNodes(flow.panelTree, (node) => node.props?.className === 'pc-questions').length, 0)

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

// ---------------------------------------------------------------------------
// Applying a candidate
// ---------------------------------------------------------------------------

test('apply replaces a chip-free draft in one insertText call and folds the panel', async () => {
  const sessionId = 'session-apply'
  const draft = 'Summarise the weekly report'
  const input = makeInput({ draft, draftRev: 3 })
  const inserts = makeInsertActions({ startRev: 5 })
  const flow = await craft(sessionId, input, inserts)

  click(findButton(flow.panelTree, EN['card.apply']))
  await settle(flow.panelRoot)

  assert.deepEqual(inserts.calls, [{
    text: 'Summarise report.md in five bullets.',
    start: 0,
    end: draft.length,
    draftRev: 5,
  }])

  // Applied results fold into a summary line.
  assert.equal(flow.panelTree.props['data-phase'], 'ready')
  assert.equal(textIncludes(flow.panelTree, EN['panel.summary'].replace('{count}', '1')), true)
  assert.ok(findButton(flow.panelTree, EN['panel.expand']))
  assert.ok(findButton(flow.panelTree, EN['panel.close']))

  // Expanding shows the cards again; the composer draft did not move in this
  // fake, so the apply action now asks to regenerate instead.
  click(findButton(flow.panelTree, EN['panel.expand']))
  await settle(flow.panelRoot)
  assert.equal(findNodes(flow.panelTree, (node) => node.type === 'article').length, 1)
  assert.ok(findButton(flow.panelTree, EN['panel.staleApply']))

  await settle(flow.buttonRoot)
  assert.equal(flow.buttonTree.props['aria-label'], EN['button.done'])

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('apply keeps attachment chips: back-to-front runs, chips never covered', async () => {
  const sessionId = 'session-chips'
  const raw = 'tidy \uFFFC up'
  const occurrences = [{ offset: 5, length: 10, clipboardText: 'slides.pdf' }]
  const input = makeInput({ draft: raw, occurrences, draftRev: 3 })
  const inserts = makeInsertActions({ startRev: 5 })
  const router = (request) => {
    if (request.url === '/api/prompt-craft/enhance') {
      return {
        status: 200,
        body: {
          ok: true,
          questions: [],
          candidates: [{ id: 'terse', label: 'Terse', text: 'tidy \uFFFC up', warnings: [] }],
          meta: { model: 'deepseek-flash', elapsedMs: 1200 },
        },
      }
    }
    return defaultRouter(request)
  }
  const flow = await craft(sessionId, input, inserts, router)

  // The Host receives the chip as a plain marker plus an attachment descriptor.
  const body = enhanceCalls()[0].body
  assert.equal(body.draft, 'tidy [\u9644\u4ef61: slides.pdf] up')
  assert.deepEqual(body.attachments, [{ index: 1, name: 'slides.pdf', kind: 'file' }])

  click(findButton(flow.panelTree, EN['card.apply']))
  await settle(flow.panelRoot)

  const segments = internals.planInsertion(raw, occurrences)
  assert.deepEqual(segments, [{ start: 0, end: 5 }, { start: 6, end: 9 }])
  assert.deepEqual(inserts.calls, [
    { text: 'tidy  up', start: 6, end: 9, draftRev: 5 },
    { text: '', start: 0, end: 5, draftRev: 6 },
  ])
  assert.equal(inserts.calls[0].text.includes('\uFFFC'), false, 'ghost attachment placeholder was written')

  // Applied work collapses to a one-line summary; expanding keeps the notice.
  assert.equal(textIncludes(flow.panelTree, EN['panel.summary'].replace('{count}', '1')), true)
  click(findButton(flow.panelTree, EN['panel.expand']))
  await settle(flow.panelRoot)
  assert.equal(textIncludes(flow.panelTree, EN['panel.applied']), true)

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

// ---------------------------------------------------------------------------
// Revise
// ---------------------------------------------------------------------------

test('shorter/specific requests carry revise and replace only that card', async () => {
  const sessionId = 'session-revise'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 2 })
  let enhanceCount = 0
  const router = (request) => {
    if (request.url === '/api/prompt-craft/enhance') {
      enhanceCount += 1
      if (enhanceCount === 1) return { status: 200, body: SUCCESS_PAYLOAD }
      return {
        status: 200,
        body: {
          ok: true,
          questions: [],
          candidates: [{ id: 'clear', label: 'Clear', text: 'Summarise.', warnings: [] }],
          meta: { model: 'deepseek-flash', elapsedMs: 800 },
        },
      }
    }
    return defaultRouter(request)
  }
  const flow = await craft(sessionId, input, makeInsertActions(), router)

  fetchCalls.length = 0
  click(findButton(flow.panelTree, EN['card.shorter']))
  await settle(flow.panelRoot)

  const calls = enhanceCalls()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body.revise, {
    id: 'clear',
    text: 'Summarise report.md in five bullets.',
    instruction: 'shorter',
  })

  const cards = findNodes(flow.panelTree, (node) => node.type === 'article')
  assert.equal(cards.length, 1)
  assert.equal(textContent(cards[0]).includes('Summarise.'), true)
  assert.equal(textContent(cards[0]).includes('five bullets'), false)

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('the compare toggle highlights the added fragments and toggles back', async () => {
  const sessionId = 'session-diff'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const flow = await craft(sessionId, input, makeInsertActions())

  assert.equal(findNodes(flow.panelTree, (node) => node.type === 'mark').length, 0)

  click(findButton(flow.panelTree, EN['card.compare']))
  await settle(flow.panelRoot)

  const firstCard = findNodes(flow.panelTree, (node) => node.type === 'article')[0]
  const diffText = findNodes(firstCard, (node) => node.props?.className === 'pc-card-text pc-diff')[0]
  assert.ok(diffText, 'the card should switch to the diff view')
  assert.equal(textContent(diffText), 'Summarise report.md in five bullets.')
  const marks = findNodes(diffText, (node) => node.type === 'mark')
  assert.ok(marks.length > 0, 'added fragments must be marked')
  assert.ok(textContent(marks).length > 0)
  assert.ok(findButton(firstCard, EN['card.compareOff']))

  click(findButton(firstCard, EN['card.compareOff']))
  await settle(flow.panelRoot)
  assert.equal(findNodes(flow.panelTree, (node) => node.type === 'mark').length, 0)

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('clicking the finished toolbar button regenerates from the current draft', async () => {
  const sessionId = 'session-regenerate'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const flow = await craft(sessionId, input, makeInsertActions())
  assert.equal(enhanceCalls().length, 1)
  assert.equal(flow.buttonTree.props['data-state'], 'ready')

  click(flow.buttonTree)
  await settle(flow.panelRoot)
  assert.equal(enhanceCalls().length, 2)
  assert.equal(enhanceCalls()[1].body.draft, 'Summarise the weekly report')

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

// ---------------------------------------------------------------------------
// Errors, retry, abort
// ---------------------------------------------------------------------------

test('a host failure shows its message verbatim and retry recovers', async () => {
  const sessionId = 'session-error'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const inserts = makeInsertActions()
  const failureRouter = (request) => {
    if (request.url === '/api/prompt-craft/enhance') {
      return { status: 503, body: { ok: false, code: 'LLM_UNAVAILABLE', message: '当前环境没有可用模型，草稿未改动。' } }
    }
    return defaultRouter(request)
  }
  const flow = await craft(sessionId, input, inserts, failureRouter)

  assert.equal(flow.buttonTree.props['data-state'], 'error')
  assert.equal(flow.buttonTree.props['aria-label'], EN['button.failed'])
  assert.equal(flow.buttonTree.props.title, EN['button.failed'])
  assert.equal(flow.panelTree.props['data-phase'], 'error')
  assert.equal(textIncludes(flow.panelTree, '当前环境没有可用模型，草稿未改动。'), true)
  assert.ok(findButton(flow.panelTree, EN['panel.retry']))
  assert.ok(findButton(flow.panelTree, EN['panel.close']))
  assert.equal(inserts.calls.length, 0, 'a failure must not touch the composer')

  resetRoutes(defaultRouter)
  click(findButton(flow.panelTree, EN['panel.retry']))
  await settle(flow.panelRoot)
  await settle(flow.buttonRoot)
  assert.equal(enhanceCalls().length, 1)
  assert.equal(flow.panelTree.props['data-phase'], 'ready')
  assert.equal(findNodes(flow.panelTree, (node) => node.type === 'article').length, 1)
  assert.equal(flow.buttonTree.props['data-state'], 'ready')

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('clicking the spinning button aborts, returns to idle, and keeps the draft', async () => {
  const sessionId = 'session-abort'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const pins = []
  const hangingRouter = (request) => {
    if (request.url === '/api/prompt-craft/enhance') {
      return new Promise((resolve, reject) => {
        const signal = request.options.signal ?? null
        if (signal === null) {
          resolve({ status: 200, body: SUCCESS_PAYLOAD })
          return
        }
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
        pins.push(signal)
      })
    }
    return defaultRouter(request)
  }
  resetRoutes(hangingRouter)
  const props = composerProps(sessionId, input, makeInsertActions())
  const buttonRoot = createRoot(Button, props)
  const tree = await settle(buttonRoot)
  click(tree)
  const running = renderOnce(buttonRoot)
  assert.equal(running.props['data-state'], 'running')

  click(running)
  await settle(buttonRoot)
  assert.equal(enhanceCalls().length, 1)
  assert.equal(buttonRoot.tree.props['data-state'], 'idle')
  assert.equal(buttonRoot.tree.props['aria-label'], EN['button.idle'])
  assert.equal(pins[0].aborted, true)

  const panelRoot = createRoot(Panel, props)
  assert.equal(await settle(panelRoot), null)

  unmount(buttonRoot)
  unmount(panelRoot)
})

test('the dock shows the running skeleton and its cancel button stops the run', async () => {
  const sessionId = 'session-cancel'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const hangingRouter = (request) => {
    if (request.url === '/api/prompt-craft/enhance') {
      return new Promise((resolve, reject) => {
        const signal = request.options.signal ?? null
        if (signal === null) {
          resolve({ status: 200, body: SUCCESS_PAYLOAD })
          return
        }
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    }
    return defaultRouter(request)
  }
  resetRoutes(hangingRouter)
  const props = composerProps(sessionId, input, makeInsertActions())
  const buttonRoot = createRoot(Button, props)
  const buttonTree = await settle(buttonRoot)
  click(buttonTree)

  const panelRoot = createRoot(Panel, props)
  const runningTree = renderOnce(panelRoot)
  assert.equal(runningTree.props['data-phase'], 'running')
  assert.equal(textIncludes(runningTree, EN['panel.running']), true)
  assert.ok(findNodes(runningTree, (node) => node.props?.className === 'pc-skeleton-bar').length > 0)

  click(findButton(runningTree, EN['panel.cancel']))
  await settle(panelRoot)
  await settle(buttonRoot)
  assert.equal(panelRoot.tree, null)
  assert.equal(buttonRoot.tree.props['data-state'], 'idle')

  unmount(buttonRoot)
  unmount(panelRoot)
})

test('a composer that refuses the edit shows the refusal notice', async () => {
  const sessionId = 'session-refused'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const inserts = makeInsertActions({ accept: () => false })
  const flow = await craft(sessionId, input, inserts)

  click(findButton(flow.panelTree, EN['card.apply']))
  await settle(flow.panelRoot)

  assert.equal(inserts.calls.length, 2, 'the writer retries exactly once per span')
  assert.equal(textIncludes(flow.panelTree, EN['panel.refused']), true)
  assert.equal(findNodes(flow.panelTree, (node) => node.type === 'article').length, 1)

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('close dismisses the panel and returns the button to idle', async () => {
  const sessionId = 'session-close'
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 0 })
  const flow = await craft(sessionId, input, makeInsertActions())
  click(findButton(flow.panelTree, EN['panel.close']))
  await settle(flow.panelRoot)
  await settle(flow.buttonRoot)
  assert.equal(flow.panelTree, null)
  assert.equal(flow.buttonTree.props['data-state'], 'idle')

  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

test('settings loads values and catalog, and save posts split provider/model', async () => {
  const router = (request) => {
    if (request.url === '/api/prompt-craft/settings') {
      if (request.method === 'POST') {
        return { status: 200, body: { ok: true, values: settingsValues(request.body ?? {}) } }
      }
      return {
        status: 200,
        body: {
          ok: true,
          values: settingsValues({ preferences: 'Prefer bullets', context: false, showDiff: true }),
          catalog: CATALOG,
        },
      }
    }
    return defaultRouter(request)
  }
  resetRoutes(router)
  const root = createRoot(Settings, {})
  let tree = await settle(root)

  assert.equal(tree.props['data-prompt-craft-settings'], '')

  const textareas = findNodes(tree, (node) => node.type === 'textarea')
  assert.equal(textareas.length, 1)
  assert.equal(textareas[0].props.maxLength, 2000)
  assert.equal(textareas[0].props.value, 'Prefer bullets')
  assert.equal(textareas[0].props.placeholder, EN['settings.preferences.placeholder'])

  const switches = findNodes(tree, (node) => node.props?.role === 'switch')
  assert.equal(switches.length, 2)
  const contextSwitch = findNodes(tree, (node) => node.type === 'button' && node.props['aria-label'] === EN['settings.context.title'])[0]
  assert.ok(contextSwitch)
  assert.equal(contextSwitch.props['aria-checked'], 'false')
  const diffSwitch = findNodes(tree, (node) => node.type === 'button' && node.props['aria-label'] === EN['settings.showDiff.title'])[0]
  assert.equal(diffSwitch.props['aria-checked'], 'true')

  const select = findNodes(tree, (node) => node.type === 'select')[0]
  assert.ok(select)
  assert.equal(select.props.value, '')
  const options = findNodes(tree, (node) => node.type === 'option')
  assert.ok(options.some((option) => textContent(option) === EN['settings.model.follow'] && option.props.value === ''))
  assert.ok(options.some((option) => option.props.value === 'deepseek-account:deepseek-flash'))
  assert.ok(options.some((option) => option.props.value === 'local:qwen'))
  assert.equal(findNodes(tree, (node) => node.type === 'optgroup').length, 2)

  // Toggle a switch, edit the preference, choose a model, save.
  click(contextSwitch)
  tree = await settle(root)
  assert.equal(
    findNodes(tree, (node) => node.type === 'button' && node.props['aria-label'] === EN['settings.context.title'])[0].props['aria-checked'],
    'true',
  )

  const textarea = findNodes(tree, (node) => node.type === 'textarea')[0]
  textarea.props.onChange({ target: { value: 'Keep replies short' } })
  tree = await settle(root)
  assert.equal(findNodes(tree, (node) => node.type === 'textarea')[0].props.value, 'Keep replies short')

  const selectNode = findNodes(tree, (node) => node.type === 'select')[0]
  selectNode.props.onChange({ target: { value: 'local:qwen' } })
  tree = await settle(root)

  const save = findButton(tree, EN['settings.save'])
  assert.ok(save)
  click(save)
  tree = await settle(root)

  const posts = settingsCalls().filter((call) => call.method === 'POST')
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].body, {
    preferences: 'Keep replies short',
    context: true,
    showDiff: true,
    provider: 'local',
    model: 'qwen',
  })
  assert.equal(textIncludes(tree, EN['settings.saved']), true)

  unmount(root)
})

test('settings degrades to preferences and switches when the catalog cannot be read', async () => {
  const router = (request) => {
    if (request.url === '/api/prompt-craft/settings') {
      return { status: 500, body: { ok: false, code: 'STORE_DOWN', message: 'broken store' } }
    }
    return defaultRouter(request)
  }
  resetRoutes(router)
  const root = createRoot(Settings, {})
  const tree = await settle(root)

  assert.equal(tree.type, 'div')
  assert.equal(findNodes(tree, (node) => node.type === 'textarea').length, 1, 'preferences must stay editable')
  assert.equal(findNodes(tree, (node) => node.props?.role === 'switch').length, 2, 'switches must stay available')

  const select = findNodes(tree, (node) => node.type === 'select')[0]
  assert.ok(select, 'a model dropdown should still render')
  const options = findNodes(tree, (node) => node.type === 'option')
  assert.ok(options.some((option) => textContent(option) === EN['settings.model.loadFailed']))
  assert.ok(options.some((option) => textContent(option) === EN['settings.model.follow']))
  assert.equal(textIncludes(tree, EN['settings.loadFailed'].replace('{message}', 'broken store')), true)

  unmount(root)
})
