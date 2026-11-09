# Prompt craft · dsh-prompt-craft

English | [中文](README.md)

A DeepSeek Harness plugin that turns a draft into actionable instructions. Review the preview and explicitly apply it to the composer. It never sends a message.

## Two-stage crafting

Every request analyzes intent, confirmed information and the current version before asking questions or generating a complete prompt. Coding, writing, learning, analysis and everyday tasks share the same workflow.

- Short drafts receive model analysis and useful execution details when justified.
- Material missing choices produce up to two questions before a candidate. Answer them or explicitly choose “Continue with known information”.
- Concrete facts must come from the draft, confirmed answers, attachment names, supplied user history or clearly readable evidence in the current images. Assistant guesses and generated versions never establish facts.
- Simple requests use natural paragraphs; complex ones may use steps or headings. No fixed template or expansion ratio.
- Complete instructions may stay unchanged with a specific explanation.

“More specific” looks for unresolved execution gaps. It retains the original intent, cumulative answers, the latest three versions and improvement records. It pauses when more information is needed to improve further. “Add information” resumes the workflow. “Shorter” preserves goals and explicit restrictions.

Repeated additions, same-direction version cycles and unsafe outputs are blocked while the previous candidate stays available. Factual and semantic checks are heuristic and cannot cover every meaning change.

One operation shares a maximum of three model calls across analysis, generation and one recovery allowance. The default total timeout is 90 seconds. Transport and format errors remain visible.

## Install and upgrade

Requires DSH `>=0.2.2-rc.1 <0.3.0` and Node `>=22`.

```sh
dsh plugin --profile desktop add dsh-prompt-craft
dsh plugin --profile web add dsh-prompt-craft
```

For source installs, clone this repository and add its local directory. Restart Harness and refresh its window after upgrading. This source uses protocol v2; old clients receive an explicit refresh message. Settings remain compatible; old temporary preview caches are not migrated.

## Preview and editing

Questions, explanations and change summaries appear in the preview. Original comparison and change highlighting are independent. Expanded reading, light/dark themes and narrow windows are supported. Regeneration retains the previous preview; cancellation restores it.

Applying checks the current draft, attachments and editor revision. Success closes the preview completely and clears that conversation's result cache. External edits start a new crafting task. Attachment chips are preserved. Changes use ordinary editor operations and can be undone; a rejected partial replacement keeps the preview open and shows recovery guidance.

Window `sessionStorage` retains results, pending questions and typed answers for up to 20 conversations. Closing a result deletes its entry. Storage failure does not prevent crafting.

## Settings and limits

Draft PNG, JPEG, WebP and GIF images are sent to the selected model during analysis, generation and repair. Image-only drafts can be crafted too; missing intent produces a question first. Results display the number of referenced images. Historical images and ordinary file contents are not read.

Up to 8 images, 10 MiB each and 20 MiB total are accepted. The chosen model must explicitly support image input. Unsupported, unknown or unavailable models produce guidance to select an image-capable conversation or crafting model, without automatic switching. `deepseek-account / deepseek-flash` has been verified.

Changed images invalidate earlier tasks. Follow-up operations reread the current files; after refresh, missing images must be reattached. Image bytes never enter the plugin's sessionStorage or logs. Host attachment admission persists images under the existing Host attachment policy. Image observations remain model-dependent and may require review.

Settings include writing preferences, optional conversation history, highlighting and a dedicated crafting model. The default follows the current conversation. Preferences live in `~/.dsh/prompt-craft/settings.json`; `DSH_PROMPT_CRAFT_SETTINGS` can override the path.

Optional row configuration:

```yaml
- id: prompt-craft
  name: dsh-prompt-craft
  config:
    maxDraftChars: 6000
    maxOutputChars: 12000
    maxOutputTokens: 3000
    timeoutMs: 90000
    contextMessages: 8
    contextChars: 6000
```

Text fields are limited to 256 KiB, image requests to 28 MiB, and confirmed answers to 64. Exceeding a limit produces an explicit error without silently dropping content.

## Data and development

Calls use the DSH host model service and authenticated channel. Inputs include the draft, confirmations, attachment names, current draft images, revision records, preferences and optional text history. Ordinary file contents and historical images are not read. No telemetry or additional relay.

Zero runtime dependencies and no production build. See [CONTRACT.md](CONTRACT.md) for protocol and UI contracts.

```sh
npm run check
npm test
npm run preview:ui
npm run test:ui
npm run eval:images
npm run eval:general:dev
npm run eval:general:accept
npm run eval:projects:verify
npm run eval:projects:accept
```

Real-model evaluations run only through explicit development commands. The general suite has 10 development cases and 20 independent acceptance cases across five categories, complete requests and iterative refinement. Acceptance requires at least 90% useful short-prompt improvements or material clarifications, with no invented facts, lost restrictions or repeated additions. Semantic judgments use two order-swapped model reviews; inspectable records are retained. The existing technical answer suites remain regression material.

See [general results](eval/GENERAL-RESULTS.md) and [evaluation instructions](eval/README.md).

The preview is non-streaming. Refresh interrupts in-flight work. Multiple attachment-preserving edits depend on the host and cannot be atomic.

[MIT](LICENSE)
