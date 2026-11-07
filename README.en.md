# Prompt craft · dsh-prompt-craft

[中文](README.md) | English

[![npm](https://img.shields.io/npm/v/dsh-prompt-craft.svg)](https://www.npmjs.com/package/dsh-prompt-craft)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A button beside the composer that turns a rough draft into an instruction a capable executor will not misread — **without making the user's decisions for them**.
The result is previewed above the input and written back only when you click apply; missing details become questions, not invented `<placeholders>`.

> A DeepSeek Harness (DSH) plugin. No runtime dependencies.

---

## How it differs from a typical "prompt enhancer"

A typical enhancer asks the model to "make the draft complete": add a goal, background, acceptance criteria, turn one sentence into three. The result reads like a form letter and quietly invents requirements the user never stated.

This plugin allows exactly three kinds of change:

1. **Disambiguate** — when a sentence has two readings, pick the better-supported one or surface the difference as a question.
2. **Fill a slot** — only when the draft itself carries the value. A value the draft does not contain is never written; it becomes a question, or the sentence stays general.
3. **Make it executable** — order multi-part asks, drop duplication, and name the deliverable's form only when the draft implies it.

Forbidden: any new fact (dates, numbers, paths, file names, URLs, versions, platforms, tools, lengths, audiences, success criteria…), section headings, filler openers or closers, length padding, and invented placeholders such as `<file path>` or "TBD".

Those rules are not only a system prompt. A deterministic gate compares each result against the draft: invented facts, template headings, length blow-up and placeholders are detected, and the model gets one repair pass with the exact violations. A version that still fails is shown with a warning badge — never silently swapped for something else.

## Install

Requires DSH `>=0.2.2-rc.1 <0.3.0` and Node `>=22`. Restart Harness after installing.

```sh
dsh plugin --profile desktop add dsh-prompt-craft   # desktop
dsh plugin --profile web add dsh-prompt-craft       # web
```

From source:

```sh
git clone https://github.com/scnu2024/dsh-prompt-craft.git
dsh plugin --profile desktop add ./dsh-prompt-craft
```

## Usage

1. Write a draft in the composer (any length).
2. Click the **craft** icon on the right of the composer.
3. A card floats **above** the input:
   - up to two **questions** at the top — answer them and click "regenerate with the answers";
   - one `standard` version below, reordered so it can be executed without re-reading.
4. Click "use this version" to write it back; or ask for "shorter" / "more specific"; or close the panel.

The run keeps going if you switch sessions. Applying is an ordinary composer edit, so `Ctrl+Z` still works. **It never sends a message.**

## Settings

`Settings → Prompt craft`:

| Option | Default | Meaning |
|---|---|---|
| My preferences | empty | Free text, e.g. `no section headings; lead with the conclusion`. Overrides the default style, never the no-invention rules. |
| Use earlier messages | on | Reads the last few turns to avoid asking what the conversation already answered. |
| Highlight changes | on | Marks added fragments in the preview. |
| Which model | follow conversation | Pin a model used only for crafting. |

Preferences live in `~/.dsh/prompt-craft/settings.json` (override with `DSH_PROMPT_CRAFT_SETTINGS`); nothing is written to the profile patch.

## Data and privacy

- Crafting is one call through DSH's own model service, using the session model (or the pinned one). No third-party relay.
- Sent to the model: the draft, composer attachment names, optional prior turns, and your preference note. **Images are not read and no files are uploaded.**
- Both routes sit on DSH's authenticated connection channel (`/api/prompt-craft/enhance`, `/api/prompt-craft/settings`); unauthenticated requests are rejected by the host.
- The only local write is the preferences file. No telemetry, no external reporting.

## Development

```sh
npm run check      # syntax checks
npm test           # node --test, zero dependencies
```

There is no build step: `client.js` is a hand-written browser module, and `index.js` plus `lib/` are loaded by the host directly.

## License

[MIT](LICENSE). The icon is original artwork.
