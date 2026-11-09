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
  if (instance.mounted) {
    assert.equal(hookCursor, instance.hookCount, 'React hook count changed between renders')
  }
  instance.hookCount = hookCursor
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
  ok: true, protocolVersion: 2, status: 'ready',
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
    return { status: 200, body: request.body?.clarificationMode === 'proceed' ? { ...SUCCESS_PAYLOAD, questions: [] } : SUCCESS_PAYLOAD }
  }
  if (request.url.split('?')[0] === '/api/prompt-craft/settings') {
    if (request.method === 'POST') {
      return { status: 200, body: { ok: true, protocolVersion: 2, status: 'ready', values: settingsValues(request.body ?? {}) } }
    }
    return { status: 200, body: { ok: true, protocolVersion: 2, status: 'ready', values: settingsValues(), catalog: CATALOG } }
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
  return fetchCalls.filter((call) => call.url.split('?')[0] === '/api/prompt-craft/settings')
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
const draftRegistry = new Map(['file-a','file-b','new-file'].map(id=>[id,{id,kind:'file',file:{name:id}}]))
const conversation = {resolveDraftAttachments:ids=>ids.map(id=>draftRegistry.get(id)).filter(Boolean)}
const ctx = {
  conversation,
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
const Panel = slotEntry('conversation.input.overlay').component
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
  return {
    state,
    useInput: (selector) => {
      React.useRef(null)
      return selector(state)
    },
  }
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
    bumpRevision() { revision += 1 },
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
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'conversation'])
  assert.equal(typeof plugin.apply, 'function')

  const fresh = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module request: ${name}`)
  })
  assert.deepEqual(fresh.inject, ['slots', 'locale', 'conversation'])
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

  const panel = slotEntry('conversation.input.overlay')
  assert.equal(panel.options.id, 'prompt-craft-panel')
  assert.equal(panel.options.order, 2)
  assert.equal(typeof panel.component, 'function')

  const settings = slotEntry('settings.section')
  assert.equal(settings.options.id, 'prompt-craft')
  assert.equal(settings.options.order, 50)
  assert.equal(typeof settings.options.label, 'function')
  assert.equal(settings.options.label(), EN.nav)
  assert.equal(typeof settings.component, 'function')

  assert.deepEqual(Object.keys(internals).sort(), [
    'buildEnhanceBody',
    'composerBoxOf',
    'diffTokens',
    'panelGeometry',
    'planInsertion',
    'portalToBody',
    'prepareDraftImages',
    'ratioOf',
  ])
})

test('the composer box is measured from the marked card, never from the window', () => {
  const rect = (top, left, width, height) => ({ top, left, width, height, right: left + width, bottom: top + height })
  const card = {
    getAttribute: (name) => (name === 'data-composer-card' ? '' : null),
    getBoundingClientRect: () => rect(300, 40, 640, 140),
    parentElement: null,
  }
  const toolRow = {
    getAttribute: () => null,
    getBoundingClientRect: () => rect(400, 40, 640, 40),
    parentElement: card,
  }
  const button = {
    getAttribute: () => null,
    getBoundingClientRect: () => rect(410, 600, 24, 24),
    parentElement: toolRow,
  }
  assert.deepEqual(internals.composerBoxOf(button), { top: 300, left: 40, width: 640 })

  // Without the marker the height heuristic still lands on the card instead of
  // a full-height layout wrapper.
  const plainCard = {
    getAttribute: () => null,
    getBoundingClientRect: () => rect(280, 24, 700, 160),
    parentElement: {
      getAttribute: () => null,
      getBoundingClientRect: () => rect(0, 0, 1280, 800),
      parentElement: null,
    },
  }
  const plainButton = {
    getAttribute: () => null,
    getBoundingClientRect: () => rect(400, 640, 24, 24),
    parentElement: plainCard,
  }
  assert.deepEqual(internals.composerBoxOf(plainButton), { top: 280, left: 24, width: 700 })
  assert.equal(internals.composerBoxOf({}), null)
})

test('the preview portals to the body when react-dom is exposed, and degrades to the element', () => {
  const element = { type: 'div' }
  // The main instance is built with a strict two-module stub, so the guarded
  // require misses and the element is rendered where it sits.
  assert.equal(internals.portalToBody(element), element)

  const withPortal = definition.factory((name) => {
    if (name === 'react') return React
    if (name === 'react-dom') {
      return { createPortal: (children, target) => ({ portal: children, target }) }
    }
    throw new Error(`unexpected module request: ${name}`)
  })
  const previousDocument = globalThis.document
  globalThis.document = { body: { tag: 'body' } }
  try {
    const wrapped = withPortal.apply.__internals.portalToBody(element)
    assert.deepEqual(wrapped, { portal: element, target: { tag: 'body' } })
  } finally {
    globalThis.document = previousDocument
  }
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
  // Host-provided runtimes only: React always, and react-dom through one
  // guarded require that the portal helper resolves lazily.
  const requires = [...source.matchAll(/require\('([^']+)'\)/gu)].map((match) => match[1])
  assert.deepEqual(requires, ['react', 'react-dom'])
  // The host DOM is touched in exactly two sanctioned places: the body portal
  // and the read-only composer box probe. Nothing else may query the document.
  assert.equal((source.match(/document\.body/gu) ?? []).length, 1)
  // No document or ancestor queries: the card is found through the shell's own
  // `data-composer-card` marker instead.
  assert.equal((source.match(/querySelector/gu) ?? []).length, 0)
  assert.equal(source.includes('innerHTML'), false)

  const marker = 'const css = `'
  const cssStart = source.indexOf(marker)
  const cssEnd = source.indexOf('`', cssStart + marker.length)
  assert.ok(cssStart > 0 && cssEnd > cssStart, 'stylesheet not found')
  const stylesheet = source.slice(cssStart + marker.length, cssEnd)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/u.test(stylesheet), false, 'hard-coded hex colour')
  assert.equal(/\b(?:rgb|rgba|hsl|hsla)\(/u.test(stylesheet), false, 'hard-coded functional colour')
  assert.ok(stylesheet.includes('var(--dsw-alias-'), 'stylesheet does not use theme tokens')
  assert.ok(stylesheet.includes('.pc-panel-body'), 'dedicated reading scroll area missing')
  assert.equal(/\.pc-card-text\s*\{[^}]*max-height/u.test(stylesheet), false, 'nested text scroll cap must be removed')
  assert.ok(stylesheet.includes('prefers-reduced-motion'), 'motion preference missing')
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

  assert.deepEqual(buildEnhanceBody({ protocolVersion: 2, draft: 'hi' }), { protocolVersion: 2, draft: 'hi' })

  assert.deepEqual(buildEnhanceBody({
    sessionId: 'session-x',
    draft: 'please tidy',
    attachments: [{ index: 1, name: 'slides.pdf', kind: 'file' }],
    answers: { 'Which file?': 'report.md' },
    revise: { id: 'terse', text: 'old text', instruction: 'specific' },
  }), {
    protocolVersion: 2,
    draft: 'please tidy',
    sessionId: 'session-x',
    attachments: [{ index: 1, name: 'slides.pdf', kind: 'file' }],
    answers: [{ q: 'Which file?', a: 'report.md' }],
    revise: { id: 'terse', text: 'old text', instruction: 'specific' },
  })

  // Empty answers, unknown instruction and invalid revise are omitted/normalised.
  assert.deepEqual(buildEnhanceBody({ draft: 'x', answers: { q: '  ' } }), { protocolVersion: 2, draft: 'x' })
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
  assert.equal(await settle(panelRoot), null, 'the overlay panel must be empty when idle')
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
  assert.deepEqual(calls[0].body, { protocolVersion: 2, draft: 'Summarise the weekly report', sessionId, revisionContext: { versions: [], improvements: [] } })

  const panel = flow.panelTree
  assert.equal(panel.type, 'div')
  assert.equal(panel.props['data-phase'], 'ready')
  assert.equal(textIncludes(panel, EN['panel.title']), true)
  assert.equal(textIncludes(panel, 'deepseek-flash'), true)
  assert.equal(textIncludes(panel, EN['panel.elapsed'].replace('{seconds}', '4.2')), true)

  const cards = findNodes(panel, (node) => node.type === 'article')
  assert.equal(cards.length, 1)
  assert.ok(textIncludes(cards[0], 'Summarise report.md in five bullets.'))
  assert.ok(textIncludes(cards[0], EN['warning.invented'].replace('{count}', '2')))
  assert.ok(textIncludes(cards[0], EN['card.chars'].replace('{before}', '27').replace('{after}', '36')))
  const body = findNodes(panel, node => node.props?.className === 'pc-panel-body')[0]
  const foot = findNodes(panel, node => node.props?.className === 'pc-panel-foot')[0]
  assert.ok(body && foot)
  assert.ok(findButton(foot, EN['card.apply']), 'apply stays outside the reading scroll area')

  // Questions: text, why and option chips are all rendered.
  assert.ok(findButton(panel, EN['panel.questionsTitle']))
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

test('a mounted panel keeps its hooks when the toolbar unmounts', async () => {
  const input = makeInput({ draft: 'Summarise the weekly report' })
  const flow = await craft('session-toolbar-unmount', input, makeInsertActions())
  unmount(flow.buttonRoot)
  assert.equal((await settle(flow.panelRoot)).props['data-phase'], 'ready')
  click(findButton(flow.panelTree, EN['panel.close']))
  assert.equal(await settle(flow.panelRoot), null)
  unmount(flow.panelRoot)
})

test('each panel uses its own session when another composer mounts', async () => {
  const input = makeInput({ draft: 'Summarise the weekly report' })
  const flow = await craft('session-panel-owner', input, makeInsertActions())
  const otherInput = makeInput({ draft: 'Write an email' })
  const otherButton = createRoot(Button, composerProps('session-other-composer', otherInput))
  await settle(otherButton)
  assert.equal((await settle(flow.panelRoot))?.props['data-phase'], 'ready')
  const otherPanel = createRoot(Panel, otherButton.props)
  assert.equal(await settle(otherPanel), null)
  unmount(otherButton)
  unmount(otherPanel)
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('the panel can mount idle, switch sessions during a request, return and apply', async () => {
  let finish
  resetRoutes((request) => request.url === '/api/prompt-craft/enhance'
    ? new Promise((resolve) => { finish = resolve })
    : defaultRouter(request))
  const input = makeInput({ draft: 'Summarise the weekly report', draftRev: 3 })
  const actions = makeInsertActions()
  const props = composerProps('session-pending-owner', input, actions)
  const panel = createRoot(Panel, props)
  assert.equal(await settle(panel), null)
  const button = createRoot(Button, props)
  click(await settle(button))
  assert.equal((await settle(panel)).props['data-phase'], 'running')

  const other = composerProps('session-pending-other', makeInput({ draft: 'Write an email' }))
  panel.props = other
  assert.equal(await settle(panel), null)
  finish({ status: 200, body: SUCCESS_PAYLOAD })
  await flushTasks()
  assert.equal(panel.dirty, false, 'a background task must not update the other session')
  panel.props = props
  assert.equal((await settle(panel)).props['data-phase'], 'ready')
  click(findButton(panel.tree, EN['card.apply']))
  await settle(panel)
  assert.equal(actions.calls.length, 1)
  assert.equal(other.inputActions.calls.length, 0)
  assert.equal(await settle(panel), null)
  unmount(button)
  unmount(panel)
})

test('typing into an empty composer attaches a stable toolbar anchor', async () => {
  const input = makeInput()
  const button = createRoot(Button, composerProps('session-late-anchor', input))
  assert.equal(await settle(button), null)
  input.state.draft = 'Summarise the weekly report'
  const first = await settle(button)
  assert.equal(typeof first.props.ref, 'function')
  const node = {}
  first.props.ref(node)
  input.state.draft += ' clearly'
  const next = await settle(button)
  assert.equal(next.props.ref, first.props.ref, 'rerendering must not detach the anchor')
  next.props.ref(null)
  unmount(button)
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

test('apply replaces a chip-free draft in one insertText call and closes the panel', async () => {
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

  assert.equal(flow.panelTree, null)

  await settle(flow.buttonRoot)
  assert.equal(flow.buttonTree.props['aria-label'], EN['button.idle'])

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
          ok: true, protocolVersion: 2, status: 'ready',
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

  assert.equal(flow.panelTree, null)

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
          ok: true, protocolVersion: 2, status: 'ready',
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

test('the overlay shows the running skeleton and its cancel button stops the run', async () => {
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
  assert.equal(textIncludes(runningTree, EN['panel.duration'].replace('{seconds}', '0')), true)
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

  assert.equal(inserts.calls.length, 1, 'a refused span stops the writer')
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
    if (request.url.split('?')[0] === '/api/prompt-craft/settings') {
      if (request.method === 'POST') {
        return { status: 200, body: { ok: true, protocolVersion: 2, status: 'ready', values: settingsValues(request.body ?? {}) } }
      }
      return {
        status: 200,
        body: {
          ok: true, protocolVersion: 2, status: 'ready',
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
    if (request.url.split('?')[0] === '/api/prompt-craft/settings') {
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

test('editing before the first apply marks the result stale and never writes', async () => {
  const input = makeInput({ draft: 'Summarise the report' })
  const actions = makeInsertActions()
  const flow = await craft('guard-first-apply', input, actions)
  input.state.draft = 'Keep this newly edited draft'
  actions.bumpRevision()
  await settle(flow.panelRoot)
  assert.ok(findButton(flow.panelTree, EN['panel.staleApply']))
  assert.equal(findButton(flow.panelTree, EN['card.apply']), null)
  assert.equal(actions.calls.length, 0)
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('a click handler captured before a revision change still refuses the write', async () => {
  const actions = makeInsertActions()
  const flow = await craft('guard-stale-handler', makeInput({ draft: 'Summarise the report' }), actions)
  const apply = findButton(flow.panelTree, EN['card.apply'])
  actions.bumpRevision()
  click(apply)
  await settle(flow.panelRoot)
  assert.equal(actions.calls.length, 0)
  assert.equal(textIncludes(flow.panelTree, EN['panel.staleApply']), true)
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('attachment changes invalidate an otherwise unchanged draft', async () => {
  const input = makeInput({ draft: 'Summarise the file', attachmentIds: ['file-a'] })
  const flow = await craft('guard-attachment', input, makeInsertActions())
  input.state.attachmentIds = ['file-b']
  await settle(flow.panelRoot)
  assert.ok(findButton(flow.panelTree, EN['panel.staleApply']))
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('applying the same result twice is idempotent', async () => {
  const input = makeInput({ draft: 'Summarise the report' })
  const actions = makeInsertActions()
  const flow = await craft('guard-idempotent', input, actions)
  const apply = findButton(flow.panelTree, EN['card.apply'])
  click(apply)
  input.state.draft = SUCCESS_PAYLOAD.candidates[0].text
  input.state.draftRev = actions.revision
  await settle(flow.panelRoot)
  click(apply)
  await settle(flow.panelRoot)
  assert.equal(actions.calls.length, 1)
  assert.equal(flow.panelTree, null)
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('a partial attachment replacement stops and reports an undo instruction', async () => {
  const input = makeInput({ draft: 'tidy \uFFFC up', occurrences: [{ offset: 5, length: 10, clipboardText: 'slides.pdf' }] })
  const actions = makeInsertActions({ accept: (count) => count === 1 })
  const flow = await craft('guard-partial', input, actions)
  click(findButton(flow.panelTree, EN['card.apply']))
  await settle(flow.panelRoot)
  assert.equal(actions.calls.length, 2)
  assert.equal(textIncludes(flow.panelTree, EN['panel.partial']), true)
  assert.ok(findButton(flow.panelTree, EN['card.copy']))
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('answers and attachment names survive consecutive revise operations and retry', async () => {
  const input = makeInput({ draft: 'tidy \uFFFC up', occurrences: [{ offset: 5, length: 10, clipboardText: 'slides.pdf' }] })
  const flow = await craft('revise-retains-facts', input, makeInsertActions())
  click(findButton(flow.panelTree, 'report.md'))
  await settle(flow.panelRoot)
  click(findButton(flow.panelTree, EN['panel.questionsSubmit']))
  await settle(flow.panelRoot)
  const expectedAnswers = enhanceCalls().at(-1).body.answers
  click(findButton(flow.panelTree, EN['card.shorter']))
  await settle(flow.panelRoot)
  assert.deepEqual(enhanceCalls().at(-1).body.answers, expectedAnswers)
  assert.equal(enhanceCalls().at(-1).body.attachments[0].name, 'slides.pdf')
  activeRouter = (request) => request.url === '/api/prompt-craft/enhance'
    ? { status: 502, body: { ok: false, message: 'temporary failure' } } : defaultRouter(request)
  click(findButton(flow.panelTree, EN['card.specific']))
  await settle(flow.panelRoot)
  assert.equal(textIncludes(flow.panelTree, SUCCESS_PAYLOAD.candidates[0].text), true)
  assert.equal(textIncludes(flow.panelTree, 'temporary failure'), true)
  activeRouter = defaultRouter
  click(findButton(flow.panelTree, EN['panel.retry']))
  await settle(flow.panelRoot)
  assert.deepEqual(enhanceCalls().at(-1).body.answers, expectedAnswers)
  assert.equal(enhanceCalls().at(-1).body.attachments[0].name, 'slides.pdf')
  unmount(flow.buttonRoot)
  unmount(flow.panelRoot)
})

test('late responses cannot replace a newer result even if transport ignores abort', async () => {
  const originalFetch = globalThis.fetch
  let finishOld
  let requests = 0
  globalThis.fetch = (url, options) => {
    if (url !== '/api/prompt-craft/enhance') return originalFetch(url, options)
    requests += 1
    const response = (text) => ({ ok: true, protocolVersion: 2, status: 'ready', json: async () => ({ ok: true, protocolVersion: 2, status: 'ready', candidates: [{ id: 'clear', text }] }) })
    if (requests === 1) return new Promise((resolve) => { finishOld = () => resolve(response('old response')) })
    return Promise.resolve(response('new response'))
  }
  const input = makeInput({ draft: 'Summarise the report' })
  const props = composerProps('response-race', input)
  const button = createRoot(Button, props)
  const panel = createRoot(Panel, props)
  try {
    click(await settle(button))
    click(await settle(button))
    click(await settle(button))
    await settle(panel)
    assert.equal(textIncludes(panel.tree, 'new response'), true)
    finishOld()
    await settle(panel)
    assert.equal(textIncludes(panel.tree, 'new response'), true)
    assert.equal(textIncludes(panel.tree, 'old response'), false)
  } finally { globalThis.fetch = originalFetch; unmount(button); unmount(panel) }
})

test('copy feedback waits for clipboard success and reports rejection', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let finishCopy
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: () => new Promise((resolve) => { finishCopy = resolve }) } } })
  const flow = await craft('clipboard-feedback', makeInput({ draft: 'Summarise the report' }), makeInsertActions())
  try {
    click(findButton(flow.panelTree, EN['card.copy']))
    await settle(flow.panelRoot)
    assert.equal(findButton(flow.panelTree, EN['card.copied']), null)
    finishCopy()
    await settle(flow.panelRoot)
    assert.ok(findButton(flow.panelTree, EN['card.copied']))
    navigator.clipboard.writeText = async () => { throw new Error('denied') }
    click(findButton(flow.panelTree, EN['card.copied']))
    await settle(flow.panelRoot)
    assert.equal(textIncludes(flow.panelTree, EN['panel.copyFailed']), true)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else delete globalThis.navigator
    unmount(flow.buttonRoot); unmount(flow.panelRoot)
  }
})

function freshClient() {
  const registrations = []
  const cleanup = []
  const fresh = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('unavailable module')
  })
  fresh.apply({ ...ctx, slots: { inject: (name, callback) => callback(), register: (options, component) => { registrations.push({ options, component }); return () => {} } }, effect: (callback) => { const dispose = callback(); if (typeof dispose === 'function') cleanup.push(dispose); return dispose } })
  return { Button: registrations.find((entry) => entry.options.name === 'conversation.input.right').component, Panel: registrations.find((entry) => entry.options.name === 'conversation.input.overlay').component, dispose: () => cleanup.reverse().forEach((dispose) => dispose()) }
}

test('refresh restores results, rebinds revisions, and applying deletes the cache', async () => {
  const previous = globalThis.sessionStorage
  const values = new Map()
  globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const input = makeInput({ draft: 'Summarise the report' })
  const flow = await craft('cache-refresh', input, makeInsertActions())
  const fresh = freshClient()
  const actions = makeInsertActions({ startRev: 99 })
  const restored = createRoot(fresh.Panel, composerProps('cache-refresh', input, actions))
  try {
    await settle(restored)
    assert.equal(textIncludes(restored.tree, SUCCESS_PAYLOAD.candidates[0].text), true)
    click(findButton(restored.tree, EN['card.apply']))
    await settle(restored)
    assert.equal(actions.calls[0].draftRev, 99)
    assert.equal(restored.tree,null)
    assert.equal(JSON.parse([...values.values()][0]).length, 0)
  } finally { unmount(restored); fresh.dispose(); unmount(flow.buttonRoot); unmount(flow.panelRoot); globalThis.sessionStorage = previous }
})

test('applying clears only its session and the next craft starts from the applied draft',async()=>{
  const previous=globalThis.sessionStorage,values=new Map()
  globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
  const input=makeInput({draft:'Summarise the report'}),actions=makeInsertActions()
  const first=await craft('apply-close-primary',input,actions)
  const second=await craft('apply-close-other',makeInput({draft:'Write a note'}),makeInsertActions())
  let fresh,restored
  try {
    click(findButton(first.panelTree,EN['card.apply']));await settle(first.panelRoot)
    assert.equal(first.panelTree,null)
    assert.deepEqual(JSON.parse([...values.values()][0]).map(x=>x.key),['apply-close-other'])
    fresh=freshClient();restored=createRoot(fresh.Panel,first.props)
    assert.equal(await settle(restored),null)
    await settle(second.panelRoot);assert.ok(findButton(second.panelTree,EN['card.apply']))
    input.state.draft=SUCCESS_PAYLOAD.candidates[0].text;input.state.draftRev=actions.revision
    click(await settle(first.buttonRoot));await settle(first.panelRoot)
    const body=enhanceCalls().at(-1).body
    assert.equal(body.draft,input.state.draft);assert.equal(body.revise,undefined);assert.equal(body.answers,undefined)
    assert.deepEqual(body.revisionContext,{versions:[],improvements:[]})
  } finally {
    unmount(first.buttonRoot);unmount(first.panelRoot);unmount(second.buttonRoot);unmount(second.panelRoot)
    if(restored)unmount(restored);fresh?.dispose();globalThis.sessionStorage=previous
  }
})

test('legacy applied summary caches are discarded without losing another preview',async()=>{
  const previous=globalThis.sessionStorage,values=new Map()
  globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
  const input=makeInput({draft:'Summarise the report'})
  const flow=await craft('legacy-applied-summary',input,makeInsertActions())
  let fresh,legacy,other
  try {
    const key=[...values.keys()][0],entries=JSON.parse(values.get(key))
    const stored=entries.find(x=>x.key==='legacy-applied-summary')
    entries.push({key:'legacy-unapplied-preview',task:{...stored.task}})
    stored.task.applied={text:'Applied result',candidateText:'Applied result',rev:5};stored.task.collapsed=true
    values.set(key,JSON.stringify(entries))
    fresh=freshClient();legacy=createRoot(fresh.Panel,composerProps('legacy-applied-summary',input))
    assert.equal(await settle(legacy),null)
    other=createRoot(fresh.Panel,composerProps('legacy-unapplied-preview',input));await settle(other)
    assert.ok(findButton(other.tree,EN['card.apply']))
    assert.deepEqual(JSON.parse(values.get(key)).map(x=>x.key),['legacy-unapplied-preview'])
  } finally {
    if(legacy)unmount(legacy);if(other)unmount(other);fresh?.dispose();unmount(flow.buttonRoot);unmount(flow.panelRoot);globalThis.sessionStorage=previous
  }
})

test('a restored result refuses a different draft and unavailable storage does not break crafting', async () => {
  const previous = globalThis.sessionStorage
  const values = new Map()
  globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const flow = await craft('cache-stale', makeInput({ draft: 'Summarise the report' }), makeInsertActions())
  const fresh = freshClient()
  const root = createRoot(fresh.Panel, composerProps('cache-stale', makeInput({ draft: 'Different draft' })))
  try {
    await settle(root)
    assert.ok(findButton(root.tree, EN['panel.staleApply']))
    globalThis.sessionStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    const working = await craft('cache-denied', makeInput({ draft: 'Summarise the report' }), makeInsertActions())
    assert.equal(working.panelTree.props['data-phase'], 'ready')
    unmount(working.buttonRoot); unmount(working.panelRoot)
  } finally { unmount(root); fresh.dispose(); unmount(flow.buttonRoot); unmount(flow.panelRoot); globalThis.sessionStorage = previous }
})

test('saving highlight preferences updates an already-open result', async () => {
  resetRoutes((request) => request.url.split('?')[0] === '/api/prompt-craft/settings'
    ? { status: 200, body: { ok: true, protocolVersion: 2, status: 'ready', values: settingsValues(request.method === 'POST' ? request.body : { showDiff: false }), catalog: CATALOG } }
    : defaultRouter(request))
  const settings = createRoot(Settings, {})
  await settle(settings)
  const flow = await craft('preference-live', makeInput({ draft: 'Summarise the report' }), makeInsertActions(), activeRouter)
  assert.equal(findNodes(flow.panelTree, (node) => node.props?.className === 'pc-card-text pc-diff').length, 0)
  click(findNodes(settings.tree, (node) => node.props?.['aria-label'] === EN['settings.showDiff.title'])[0])
  await settle(settings)
  click(findButton(settings.tree, EN['settings.save']))
  await settle(settings)
  await settle(flow.panelRoot)
  assert.equal(findNodes(flow.panelTree, (node) => node.props?.className === 'pc-card-text pc-diff').length, 1)
  unmount(settings); unmount(flow.buttonRoot); unmount(flow.panelRoot)
})

test('the client watchdog terminates a stalled request and unloading aborts active work', async () => {
  const originalSet = globalThis.setTimeout
  const originalClear = globalThis.clearTimeout
  const pending = []
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay > 10000) { const handle = { callback, active: true, unref() {} }; pending.push(handle); return handle }
    return originalSet(callback, delay, ...args)
  }
  globalThis.clearTimeout = (handle) => handle?.callback ? (handle.active = false) : originalClear(handle)
  let signal
  resetRoutes((request) => {
    if (request.url === '/api/prompt-craft/enhance') { signal = request.options.signal; return new Promise(() => {}) }
    return defaultRouter(request)
  })
  const fresh = freshClient()
  const props = composerProps('client-watchdog', makeInput({ draft: 'Summarise the report' }))
  const button = createRoot(fresh.Button, props)
  const panel = createRoot(fresh.Panel, props)
  try {
    click(await settle(button))
    await settle(panel)
    pending.findLast((timer) => timer.active).callback()
    await settle(panel)
    assert.equal(textIncludes(panel.tree, EN['error.timeout']), true)
    assert.equal(signal.aborted, true)
    click(findButton(panel.tree, EN['panel.retry']))
    await settle(panel)
    const nextSignal = signal
    fresh.dispose()
    assert.equal(nextSignal.aborted, true)
    assert.equal(pending.some((timer) => timer.active), false)
  } finally { unmount(button); unmount(panel); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear }
})

test('the temporary result cache evicts old sessions after twenty entries', async () => {
  const previous = globalThis.sessionStorage
  const values = new Map()
  globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  try {
    for (let index = 0; index < 21; index += 1) {
      const flow = await craft(`cache-limit-${index}`, makeInput({ draft: 'Summarise the report' }), makeInsertActions())
      unmount(flow.buttonRoot); unmount(flow.panelRoot)
    }
    const entries = JSON.parse([...values.values()][0])
    assert.equal(entries.length, 20)
    assert.equal(entries.some((entry) => entry.key === 'cache-limit-0'), false)
    assert.equal(entries.at(-1).key, 'cache-limit-20')
  } finally { globalThis.sessionStorage = previous }
})

test('unchanged candidates explain that the original prompt was preserved', async () => {
  resetRoutes((request) => request.url.endsWith('/enhance') ? { status: 200, body: { ...SUCCESS_PAYLOAD, questions: [], meta: { ...SUCCESS_PAYLOAD.meta, unchanged: true } } } : defaultRouter(request))
  const props = composerProps('preserved-notice', makeInput({ draft: 'Explain closures.' }), makeInsertActions())
  const button = createRoot(Button, props)
  const panel = createRoot(Panel, props)
  await settle(button); await settle(panel)
  click(findButton(button.tree, EN['button.idle']))
  await settle(button); await settle(panel)
  assert.equal(textIncludes(panel.tree, EN['panel.unchanged']), true)
  unmount(button); unmount(panel)
})

test('both cancellation controls restore the previous successful candidate', async () => {
  for (const which of [0, 1]) {
    let requests = 0
    const router = (request) => {
      if (request.url === '/api/prompt-craft/enhance' && ++requests > 1) return new Promise(() => {})
      return defaultRouter(request)
    }
    const flow = await craft('cancel-preserve-' + which, makeInput({ draft: 'Summarise the report' }), makeInsertActions(), router)
    click(flow.buttonTree)
    const running = await settle(flow.panelRoot)
    const controls = findNodes(running, node => node.type === 'button' && (textContent(node) === EN['panel.cancel'] || node.props['aria-label'] === EN['panel.cancel']))
    assert.equal(controls.length, 2)
    click(controls[which])
    await settle(flow.panelRoot)
    assert.equal(textIncludes(flow.panelTree, SUCCESS_PAYLOAD.candidates[0].text), true)
    assert.equal(flow.panelTree.props['data-phase'], 'ready')
    unmount(flow.buttonRoot); unmount(flow.panelRoot)
  }
})

test('reading geometry stays within narrow, short and shifted visual viewports', () => {
  const { panelGeometry } = internals
  const desktop = panelGeometry({ top: 700, left: 300, width: 900 }, { width: 1440, height: 1000 })
  assert.equal(desktop.expanded, false)
  assert.equal(desktop.style.width, 860)
  assert.ok(desktop.style.maxHeight <= 620)
  const hero = panelGeometry({ top: 180, left: 20, width: 350 }, { width: 390, height: 700 })
  assert.equal(hero.expanded, true)
  assert.equal(hero.style.width, 366)
  assert.equal(hero.style.height, 588)
  const compact = panelGeometry({ top: 180, left: 20, width: 350 }, { width: 390, height: 700 }, false)
  assert.equal(compact.expanded, false)
  for (const width of [390, 768, 1440]) for (const height of [320, 700, 1000]) {
    for (const expanded of [undefined, false, true]) {
      const result = panelGeometry({ top: height * .3, left: 25, width: 860 }, { width, height }, expanded).style
      assert.ok(result.left >= 12)
      assert.ok(result.left + result.width <= width - 12)
      assert.ok(result.bottom >= 12)
      assert.ok(result.bottom + result.maxHeight <= height - 12 + .001)
    }
  }
  const keyboard = panelGeometry({ top: 480, left: 20, width: 350 }, { width: 390, height: 320, top: 140 }, true)
  assert.ok(keyboard.style.top >= 152)
  assert.ok(keyboard.style.top + keyboard.style.maxHeight <= 448)
})

test('reading mode and original visibility belong to each session and reset after close', async () => {
  const first = await craft('view-first', makeInput({ draft: 'First draft' }), makeInsertActions())
  click(findButton(first.panelTree, EN['panel.read']))
  click(findButton(first.panelTree, EN['card.showOriginal']))
  await settle(first.panelRoot)
  assert.equal(first.panelTree.props['data-reading'], 'expanded')
  assert.ok(textIncludes(first.panelTree, 'First draft'))
  const second = await craft('view-second', makeInput({ draft: 'Second draft' }), makeInsertActions())
  assert.equal(second.panelTree.props['data-reading'], 'compact')
  assert.equal(findNodes(second.panelTree, node => node.props?.className === 'pc-original').length, 0)
  const firstProps = first.panelRoot.props
  first.panelRoot.props = second.panelRoot.props
  await settle(first.panelRoot)
  assert.equal(first.panelTree.props['data-reading'], 'compact')
  first.panelRoot.props = firstProps
  await settle(first.panelRoot)
  assert.equal(first.panelTree.props['data-reading'], 'expanded')
  assert.ok(findButton(first.panelTree, EN['card.hideOriginal']))
  click(findButton(first.panelTree, EN['panel.compact']))
  await settle(first.panelRoot)
  assert.equal(first.panelTree.props['data-reading'], 'compact')
  click(findButton(first.panelTree, EN['panel.close']))
  await settle(first.panelRoot); await settle(first.buttonRoot)
  click(first.buttonTree)
  await settle(first.panelRoot)
  assert.equal(findNodes(first.panelTree, node => node.props?.className === 'pc-original').length, 0)
  for (const flow of [first, second]) { unmount(flow.buttonRoot); unmount(flow.panelRoot) }
})

test('optional questions preserve typed answers when folded and reopen on a new result', async () => {
  const flow = await craft('fold-questions', makeInput({ draft: 'Summarise the report' }), makeInsertActions())
  const input = findNodes(flow.panelTree, node => node.type === 'input')[0]
  input.props.onChange({ target: { value: 'custom.md' } })
  click(findButton(flow.panelTree, EN['panel.questionsTitle']))
  await settle(flow.panelRoot)
  assert.equal(findNodes(flow.panelTree, node => node.type === 'input').length, 0)
  click(findButton(flow.panelTree, EN['panel.questionsTitle']))
  await settle(flow.panelRoot)
  assert.equal(findNodes(flow.panelTree, node => node.type === 'input')[0].props.value, 'custom.md')
  click(findButton(flow.panelTree, EN['panel.questionsTitle']))
  await settle(flow.panelRoot)
  click(flow.buttonTree)
  await settle(flow.panelRoot)
  assert.equal(findButton(flow.panelTree, EN['panel.questionsTitle']).props['aria-expanded'], true)
  unmount(flow.buttonRoot); unmount(flow.panelRoot)
})

test('regeneration displays the previous text and prevents applying it until cancellation', async () => {
  let count = 0
  const router = request => request.url.endsWith('/enhance') && ++count > 1 ? new Promise(() => {}) : defaultRouter(request)
  const actions = makeInsertActions()
  const flow = await craft('visible-previous', makeInput({ draft: 'Summarise the report' }), actions, router)
  const capturedApply = findButton(flow.panelTree, EN['card.apply'])
  click(flow.buttonTree)
  const running = await settle(flow.panelRoot)
  assert.ok(textIncludes(running, SUCCESS_PAYLOAD.candidates[0].text))
  assert.equal(findButton(running, EN['card.apply']).props.disabled, true)
  assert.equal(findButton(running, EN['card.shorter']).props.disabled, true)
  click(capturedApply)
  assert.equal(actions.calls.length, 0)
  click(findButton(running, EN['panel.cancel']))
  await settle(flow.panelRoot)
  assert.equal(findButton(flow.panelTree, EN['card.apply']).props.disabled, false)
  unmount(flow.buttonRoot); unmount(flow.panelRoot)
})

test('Escape leaves expanded reading first and then closes the compact result', async () => {
  const handlers = new Map()
  const previous = globalThis.document
  globalThis.document = { addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name) } }
  let flow
  try {
    flow = await craft('escape-reading', makeInput({ draft: 'Summarise the report' }), makeInsertActions())
    click(findButton(flow.panelTree, EN['panel.read']))
    await settle(flow.panelRoot)
    handlers.get('keydown')({ key: 'Escape', preventDefault() {} })
    await settle(flow.panelRoot)
    assert.equal(flow.panelTree.props['data-reading'], 'compact')
    handlers.get('keydown')({ key: 'Escape', preventDefault() {} })
    await settle(flow.panelRoot)
    assert.equal(flow.panelTree, null)
  } finally {
    if (flow) { unmount(flow.buttonRoot); unmount(flow.panelRoot) }
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('settings groups preferences, preview and model with a live character count', async () => {
  resetRoutes()
  const root = createRoot(Settings, {})
  const tree = await settle(root)
  assert.equal(findNodes(tree, node => node.props?.className === 'pc-settings-group').length, 3)
  const textarea = findNodes(tree, node => node.type === 'textarea')[0]
  textarea.props.onChange({ target: { value: 'Prefer concise wording' } })
  await settle(root)
  assert.ok(textIncludes(root.tree, '22 / 2000'))
  assert.equal(textarea.props['aria-label'], EN['settings.preferences.title'])
  unmount(root)
})

// v2 lifecycle: terminal success and waiting for answers are separate states.
const v2 = (status, extra = {}) => ({ ok: true, protocolVersion: 2, status, reason: 'A concrete explanation', candidates: [], questions: [], changes: [], meta: {}, ...extra })
const readyV2 = text => v2('ready', { candidates: [{ id: 'clear', label: 'Clear', text }], changes: [{ id: 'i1', summary: text }] })
function fillAnswer(tree, value, index = 0) {
  const fields = findNodes(tree, node => node.props?.className === 'pc-answer-input')
  fields[index].props.onChange({ target: { value } })
}

test('v2 questions-only results accumulate answers and resume a revision after a new question', async () => {
  let index = 0
  const replies = [v2('needs_input', { questions: [{ q: 'Audience?' }] }), v2('needs_input', { questions: [{ q: 'Purpose?' }] }), readyV2('Write a clear note for the team.'), v2('needs_input', { questions: [{ q: 'Tone?' }] }), readyV2('Write a concise, friendly note for the team.')]
  const router = req => req.url.endsWith('/enhance') ? { body: replies[index++] } : defaultRouter(req)
  const flow = await craft('v2-multiround', makeInput({ draft: 'Write a note' }), makeInsertActions(), router)
  assert.equal(flow.panelTree.props['data-status'], 'needs_input')
  assert.equal(findNodes(flow.panelTree, n => n.type === 'article').length, 0)
  assert.equal(findButton(flow.panelTree, EN['panel.questionsSubmit']).props.disabled, true)
  fillAnswer(flow.panelTree, 'Team'); await settle(flow.panelRoot)
  click(findButton(flow.panelTree, EN['panel.questionsSubmit'])); await settle(flow.panelRoot)
  fillAnswer(flow.panelTree, 'Meeting'); await settle(flow.panelRoot)
  click(findButton(flow.panelTree, EN['panel.questionsSubmit'])); await settle(flow.panelRoot)
  assert.deepEqual(enhanceCalls().at(-1).body.answers, [{q:'Audience?',a:'Team'},{q:'Purpose?',a:'Meeting'}])
  click(findButton(flow.panelTree, EN['card.specific'])); await settle(flow.panelRoot)
  assert.equal(flow.panelTree.props['data-status'],'needs_input')
  assert.equal(findButton(flow.panelTree, EN['card.apply']).props.disabled,true)
  fillAnswer(flow.panelTree, 'Friendly'); await settle(flow.panelRoot)
  click(findButton(flow.panelTree, EN['panel.questionsSubmit'])); await settle(flow.panelRoot)
  const last=enhanceCalls().at(-1).body
  assert.equal(last.revise.instruction,'specific');assert.equal(last.revise.text,'Write a clear note for the team.')
  assert.equal(last.answers.length,3);assert.equal(last.draft,'Write a note')
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})

test('five specificity revisions carry bounded history, stop at exhaustion and unlock after new information', async () => {
  let index=0
  const router=req=>{
    if(!req.url.endsWith('/enhance'))return defaultRouter(req)
    index++
    return {body:index===6?v2('unchanged',{candidates:[{id:'clear',text:'Version 5'}],meta:{specificExhausted:true,unchanged:true}}):readyV2('Version '+index)}
  }
  const flow=await craft('v2-five',makeInput({draft:'Plan this task'}),makeInsertActions(),router)
  for(let i=0;i<5;i++){
    const button=findButton(flow.panelTree,EN['card.specific']);assert.equal(button.props.disabled,false)
    click(button);await settle(flow.panelRoot)
  }
  assert.equal(enhanceCalls().length,6)
  assert.equal(findButton(flow.panelTree,EN['card.specific']).props.disabled,true)
  assert.ok(enhanceCalls().every(c=>(c.body.revisionContext?.versions.length??0)<=3))
  assert.equal(enhanceCalls().at(-1).body.revisionContext.improvements.length,5)
  click(findButton(flow.panelTree,EN['panel.addInformation']));await settle(flow.panelRoot)
  fillAnswer(flow.panelTree,'Focus on clarity');await settle(flow.panelRoot)
  click(findButton(flow.panelTree,EN['panel.questionsSubmit']));await settle(flow.panelRoot)
  assert.equal(findButton(flow.panelTree,EN['card.specific']).props.disabled,false)
  assert.equal(enhanceCalls().at(-1).body.answers[0].a,'Focus on clarity')
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})

test('v2 continue with known information dispatches explicitly without clearing prior answers', async () => {
  let count=0
  const flow=await craft('v2-proceed',makeInput({draft:'Write a note'}),makeInsertActions(),req=>req.url.endsWith('/enhance')?{body:++count===1?v2('needs_input',{questions:[{q:'Audience?'}]}):readyV2('Write a clear note.')} : defaultRouter(req))
  fillAnswer(flow.panelTree,'Team');await settle(flow.panelRoot)
  click(findButton(flow.panelTree,EN['panel.questionsIgnore']));await settle(flow.panelRoot)
  assert.equal(enhanceCalls().at(-1).body.clarificationMode,'proceed')
  assert.deepEqual(enhanceCalls().at(-1).body.answers,[{q:'Audience?',a:'Team'}])
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})

test('v2 blocked revision keeps the current candidate and shows the reason', async () => {
  let count=0
  const flow=await craft('v2-blocked',makeInput({draft:'Explain this'}),makeInsertActions(),req=>req.url.endsWith('/enhance')?{body:++count===1?readyV2('Explain the supplied example.'):v2('blocked',{reason:'Repeated additions were rejected.'})}:defaultRouter(req))
  click(findButton(flow.panelTree,EN['card.specific']));await settle(flow.panelRoot)
  assert.equal(flow.panelTree.props['data-status'],'blocked')
  assert.equal(textIncludes(flow.panelTree,'Explain the supplied example.'),true)
  assert.equal(textIncludes(flow.panelTree,'Repeated additions were rejected.'),true)
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})

test('external draft or attachment edits reset answers and revision history before refining', async () => {
  for(const change of ['draft','attachments']){
    const input=makeInput({draft:'Write a note'})
    const flow=await craft('v2-reset-'+change,input,makeInsertActions(),req=>req.url.endsWith('/enhance')?{body:readyV2('Write a clear note.')}:defaultRouter(req))
    if(change==='draft')input.state.draft='Explain closure'
    else input.state.attachmentIds=['new-file']
    await settle(flow.panelRoot)
    click(findButton(flow.panelTree,EN['card.specific']));await settle(flow.panelRoot)
    const body=enhanceCalls().at(-1).body
    assert.equal(body.revise,undefined);assert.equal(body.answers,undefined);assert.deepEqual(body.revisionContext,{versions:[],improvements:[]})
    unmount(flow.buttonRoot);unmount(flow.panelRoot)
  }
})

test('v2 refresh restores questions, typed answers and pending revision state without a candidate', async () => {
  const previous=globalThis.sessionStorage,values=new Map()
  globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
  let fresh,restored
  const input=makeInput({draft:'Write a note'})
  const flow=await craft('v2-question-cache',input,makeInsertActions(),req=>req.url.endsWith('/enhance')?{body:v2('needs_input',{questions:[{q:'Audience?'}]})}:defaultRouter(req))
  try{
    fillAnswer(flow.panelTree,'Team');await settle(flow.panelRoot)
    fresh=freshClient();restored=createRoot(fresh.Panel,composerProps('v2-question-cache',input))
    await settle(restored)
    assert.equal(restored.tree.props['data-status'],'needs_input')
    assert.equal(findNodes(restored.tree,n=>n.props?.className==='pc-answer-input')[0].props.value,'Team')
    assert.ok([...values.keys()].every(key=>key.endsWith(':v2')))
  }finally{unmount(flow.buttonRoot);unmount(flow.panelRoot);if(restored)unmount(restored);fresh?.dispose();globalThis.sessionStorage=previous}
})

const imageData='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII='
function registerImage(id,extra={}) {
  const file=new File([Buffer.from(imageData,'base64')],'same.png',{type:'image/png'})
  draftRegistry.set(id,{id,kind:'image',file,...extra});return draftRegistry.get(id)
}
function imageRouter(request) {
  const result=defaultRouter(request)
  if(request.url.includes('/settings'))result.body.capabilities={draftImages:true}
  else result.body={...readyV2('Explain the supplied screenshot and identify the relevant evidence.'),meta:{model:'vision',imagesUsed:request.body.images?.length??0}}
  return result
}
test('image-only composers send image bytes and preserve ordered duplicate filenames',async()=>{
  registerImage('img-a');registerImage('img-b')
  const flow=await craft('image-only',makeInput({attachmentIds:['img-a','img-b']}),makeInsertActions(),imageRouter)
  const body=enhanceCalls().at(-1).body
  assert.equal(body.draft,'');assert.deepEqual(body.images.map(x=>[x.index,x.name,x.data]),[[1,'same.png',imageData],[2,'same.png',imageData]])
  assert.equal(body.attachments.length,2);assert.ok(body.attachments.every(x=>x.kind==='image'))
  assert.equal(textIncludes(flow.panelTree,'Referenced 2 image(s)'),true)
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})
test('mixed file and image references keep input order and do not read file content',async()=>{
  registerImage('mixed-image')
  const flow=await craft('image-mixed',makeInput({draft:'Explain this',attachmentIds:['file-a','mixed-image']}),makeInsertActions(),imageRouter)
  const body=enhanceCalls().at(-1).body;assert.equal(body.images[0].index,2);assert.equal(body.attachments[0].kind,'file');assert.equal(body.attachments[1].kind,'image')
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})
test('legacy hosts cannot silently ignore supplied images',async()=>{
  registerImage('old-host-image')
  const flow=await craft('image-old-host',makeInput({draft:'Explain this',attachmentIds:['old-host-image']}),makeInsertActions(),defaultRouter)
  assert.equal(enhanceCalls().length,0);assert.equal(textIncludes(flow.panelTree,EN['error.outdated']),true)
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})
test('unavailable draft attachments show an error without a text-only model request',async()=>{
  const flow=await craft('image-missing',makeInput({draft:'Explain this',attachmentIds:['unavailable-image']}),makeInsertActions(),imageRouter)
  assert.equal(enhanceCalls().length,0);assert.equal(textIncludes(flow.panelTree,EN['error.imagesUnavailable']),true)
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})
test('invalid type, size and failed image reads never send model requests',async()=>{
  for(const [suffix,file,error] of [
    ['type',{name:'bad.svg',size:10,type:'image/svg+xml'},'error.imageLimits'],
    ['size',{name:'large.png',size:11*1024*1024,type:'image/png'},'error.imageLimits'],
    ['read',{name:'bad.png',size:10,type:'image/png',arrayBuffer:async()=>{throw Error('secret')}},'error.imageRead'],
  ]){
    registerImage('bad-'+suffix,{file})
    const flow=await craft('image-'+suffix,makeInput({draft:'Explain',attachmentIds:['bad-'+suffix]}),makeInsertActions(),imageRouter)
    assert.equal(enhanceCalls().length,0);assert.equal(textIncludes(flow.panelTree,EN[error]),true)
    unmount(flow.buttonRoot);unmount(flow.panelRoot)
  }
})
test('cancellation while reading a file prevents sending its eventual bytes',async()=>{
  let finish
  registerImage('pending-img',{file:{name:'pending.png',size:1,type:'image/png',arrayBuffer:()=>new Promise(resolve=>{finish=()=>resolve(Uint8Array.of(1).buffer)})}})
  resetRoutes(imageRouter)
  const input=makeInput({draft:'Explain',attachmentIds:['pending-img']}),props=composerProps('image-read-cancel',input),button=createRoot(Button,props),panel=createRoot(Panel,props)
  click(await settle(button));await settle(panel);assert.equal(typeof finish,'function')
  click(await settle(button));finish();await settle(panel);assert.equal(enhanceCalls().length,0)
  unmount(button);unmount(panel)
})
test('image replacement during reading invalidates the request before transmission',async()=>{
  let finish
  registerImage('reading-img',{file:{name:'pending.png',size:1,type:'image/png',arrayBuffer:()=>new Promise(resolve=>{finish=()=>resolve(Uint8Array.of(1).buffer)})}})
  resetRoutes(imageRouter)
  const input=makeInput({draft:'Explain',attachmentIds:['reading-img']}),props=composerProps('image-read-race',input),button=createRoot(Button,props),panel=createRoot(Panel,props)
  click(await settle(button));await settle(panel)
  registerImage('reading-img');await settle(panel);finish();await settle(panel)
  assert.equal(enhanceCalls().length,0);assert.equal(textIncludes(panel.tree,EN['error.imageStale']),true)
  unmount(button);unmount(panel)
})
test('image edits during inference cannot install a late candidate',async()=>{
  registerImage('late-img');let finish
  const flow=await craft('image-late',makeInput({draft:'Explain',attachmentIds:['late-img']}),makeInsertActions(),request=>request.url.endsWith('/enhance')?new Promise(resolve=>{finish=()=>resolve(imageRouter(request))}):imageRouter(request))
  registerImage('late-img');finish();await settle(flow.panelRoot)
  assert.equal(textIncludes(flow.panelTree,EN['error.imageStale']),true);assert.equal(findButton(flow.panelTree,EN['card.apply']),null)
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})
test('refining rereads images, keeps their references and applying preserves attachment ids',async()=>{
  let reads=0
  const entry=registerImage('refine-img');const read=entry.file.arrayBuffer.bind(entry.file);entry.file.arrayBuffer=()=>{reads++;return read()}
  const input=makeInput({draft:'Explain this',attachmentIds:['refine-img']}),actions=makeInsertActions()
  const flow=await craft('image-refine',input,actions,imageRouter)
  click(findButton(flow.panelTree,EN['card.specific']));await settle(flow.panelRoot)
  assert.equal(reads,2);assert.equal(enhanceCalls().at(-1).body.images[0].data,imageData)
  click(findButton(flow.panelTree,EN['card.apply']));await settle(flow.panelRoot)
  assert.deepEqual(input.state.attachmentIds,['refine-img']);assert.equal(actions.calls.length,1)
  unmount(flow.buttonRoot);unmount(flow.panelRoot)
})
test('image results refresh without caching bytes and refuse applying after images disappear',async()=>{
  const previous=globalThis.sessionStorage,values=new Map()
  globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
  registerImage('cached-img');let fresh,restored
  const input=makeInput({draft:'Explain this',attachmentIds:['cached-img']}),actions=makeInsertActions()
  const flow=await craft('image-cache',input,actions,imageRouter)
  try {
    assert.ok(![...values.values()].join('').includes(imageData))
    fresh=freshClient();draftRegistry.delete('cached-img')
    restored=createRoot(fresh.Panel,composerProps('image-cache',input,actions));await settle(restored)
    assert.equal(textIncludes(restored.tree,'Explain the supplied screenshot'),true)
    assert.equal(textIncludes(restored.tree,EN['panel.staleApply']),true);assert.equal(actions.calls.length,0)
    const before=enhanceCalls().length
    click(findButton(restored.tree,EN['card.specific']));await settle(restored)
    assert.equal(enhanceCalls().length,before)
    assert.equal(textIncludes(restored.tree,EN['error.imagesUnavailable']),true)
    assert.equal(textIncludes(restored.tree,'Explain the supplied screenshot'),true)
  } finally {unmount(flow.buttonRoot);unmount(flow.panelRoot);if(restored)unmount(restored);fresh?.dispose();globalThis.sessionStorage=previous}
})
