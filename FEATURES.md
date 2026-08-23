# Feature Log

Summary of the features added on top of the base Subtitle Translator app in this
working session. For the app's original capabilities (batch translation, 35
providers, live results streaming, CLI), see [README.md](./README.md).

## 1. Bilingual ASS handling

Two new modals in the web app for `.ass`/`.ssa` files that carry two language
tracks in one file (a common fansub convention — separate `Style` per
language, e.g. `JP`/`CN`).

### Split Bilingual

**`src/app/components/SplitBilingualModal.tsx`**

Splits a bilingual `.ass` file into standalone monolingual files.

- Auto-detects language tracks by grouping `Style` entries and counting
  dialogue lines per group (`detectAssLanguageGroups` in
  [`src/app/lib/translation/formats/subtitle.ts`](./src/app/lib/translation/formats/subtitle.ts)).
  A style contributing ≥40% of the largest group's line count counts as a
  "main" language track; everything else (OP/ED lyrics, STAFF credits,
  stickers) is a "minor style" that can optionally be folded into every
  exported track.
- Manual override: an "Advanced" panel lets you reassign styles to groups by
  hand for files the heuristic gets wrong, or to split into more than 2
  groups.
- Works in both single-file and multi-file (batch) upload mode — batch mode
  detects tracks from the first uploaded file and applies the same split
  config to every file in the batch.

### Bilingual Translate

**`src/app/components/BilingualTranslateModal.tsx`**

Translates each detected language track independently to its own target
language, then reassembles a new bilingual (or, if both tracks share a
target, single-language) file.

- Per-track source/target language pickers, with a checkbox to exclude a
  track entirely from the output.
- Target-language collision guard: if two enabled tracks are set to the same
  target, the confirm button is disabled with an explanation (translating two
  different-language versions of the same line into the same target would
  produce two duplicate lines at the same timestamp).
- Minor styles (OP/ED/STAFF/etc.) can be **kept as-is**, **dropped**, or
  **translated too** (with its own target-language picker).
- Default target language is derived from the app's current UI locale.
- Shares the app's existing translation pipeline
  (`splitAssByStyles` → `filterSubLines` → `prepareAssForTranslation` →
  `translateBatch` → `restoreAssAfterTranslation` → `assembleSubtitleOutput`)
  per track, then merges the per-track outputs back into one file with
  `mergeAssOutputs`.

## 2. Batch download results panel

**`src/app/components/BatchDownloadResults.tsx`**

Both modals above (and the app's other batch flows) used to call
`downloadFile()` once per output file, back-to-back. Browsers treat several
downloads fired in quick succession as suspicious and silently block them
after the first — which read to users as "batch processing just stopped
working."

Fix: neither modal auto-downloads anymore, in single-file or batch mode.
Instead:

- Every output is tracked as an `OutputItem` with a status —
  `pending` → `processing` → `done` / `error` — updated live as processing
  runs, so the panel shows real progress per output (not just an overall
  spinner).
- A finished item gets its own download button immediately, before the rest
  of the batch finishes.
- A "Download selected" button downloads the checked items one at a time
  (still spaced out, but user-triggered so browsers don't flag it), and
  "Download as ZIP" bundles them into one `.zip` via `jszip` — a single
  `downloadFile()` call, immune to the multi-download block by construction.
- A running batch can be cancelled mid-way; already-finished items stay
  downloadable.

## 3. Character naming/relationship graph (standalone prototype)

**`scripts/character-graph.ts` + `scripts/characterGraph/*`**

Not wired into the app yet — a CLI prototype for solving a problem the
existing Glossary feature doesn't cover: **identity-consistent** forms of
address (who calls whom what, and how they refer to themselves), grounded in
a subtitle file's original-language track, as opposed to a flat
term-for-term glossary.

```bash
yarn character-graph -i episode01.ass --grounding JP
```

### Schema (`scripts/characterGraph/schema.ts`)

A `CharacterGraph` is built **per subtitle file** (not per season — season-
wide continuity for recurring characters is a later merge step, out of
scope for now):

- `characters[]` — id, canonical name (grounded in the source-language
  track), every alias seen across all tracks, an optional short role label,
  and a free-text note. Characters that never appear in any address relation
  are pruned.
- `formsOfAddress[]` — flat list of `(usedBy, usedFor, term, register,
  selfReference?, firstSeenAt, changeNote?)` entries. `selfReference` is
  first-person: how the speaker refers to *themself* when addressing this
  particular person — necessary because target languages with reciprocal
  pronoun pairs (Vietnamese anh↔em, chị↔em, tớ↔cậu, etc.) can have the
  "what I call you" half translated correctly while the "what I call myself"
  half silently mismatches it. A pair using more than one term across an
  episode gets one entry per term, with `changeNote` explaining the shift
  when the dialogue makes it explicit (a naming negotiation, a relationship
  turn).

### Extraction (`scripts/characterGraph/prompt.ts`, `extract.ts`)

Builds a system+user prompt with four rules (GROUNDING, PRUNE,
CHANGE-TRACKING, SELF-REFERENCE) and every dialogue line from the grounding
track (plus other tracks in the file, shown as reference-only context) —
see the file for the full prompt text.

**Grounding is per translation job, not per file**: `--grounding` picks
whichever track is actually being translated, not necessarily the file's
original language — a bilingual file translated independently per track
(JP→X, CN→Y) needs a separate graph per track, each grounded on its own
source.

### LLM call (Phase 2) — multi-provider

With an API key available, the script calls a real LLM and validates the
JSON response against the schema (`scripts/characterGraph/validate.ts`)
before writing it out; without one, it stops after writing the prompt file
for manual use.

Supported providers (`--provider`):

| Provider | Notes |
|---|---|
| `gemini` (default) | Google Gemini REST API (`geminiClient.ts`); supports `$GEMINI_API_KEY` |
| `claude` | Anthropic Messages API (`claudeClient.ts`); supports `$ANTHROPIC_API_KEY` / `$CLAUDE_API_KEY` |
| `openai` | OpenAI API (`gpt-5.6-luna`, `gpt-4o-mini`, etc.); supports `$OPENAI_API_KEY` |
| `deepseek` | DeepSeek native API (`deepseek-v4-flash`); supports `$DEEPSEEK_API_KEY` |
| `qwen` | Alibaba Qwen / DashScope API (`qwen3.7-plus`); supports `$QWEN_API_KEY` / `$DASHSCOPE_API_KEY` |
| `siliconflow` | SiliconFlow API (`deepseek-ai/DeepSeek-V4-Flash`); supports `$SILICONFLOW_API_KEY` |
| `zhipu` | Zhipu GLM API (`glm-5.2`); supports `$ZHIPU_API_KEY` |
| `doubao` | ByteDance Volcengine Doubao (`doubao-seed-2-1-turbo-260628`); supports `$VOLCENGINE_API_KEY` |
| `minimax` | MiniMax API (`MiniMax-M3`) |
| `qianfan` | Baidu ERNIE Qianfan (`ernie-5.1`); supports `$QIANFAN_API_KEY` |
| `mistral` | Mistral AI (`mistral-medium-3-5`); supports `$MISTRAL_API_KEY` |
| `grok` | xAI Grok (`grok-4.5`); supports `$XAI_API_KEY` / `$GROK_API_KEY` |
| `perplexity` | Perplexity (`sonar`); supports `$PERPLEXITY_API_KEY` |
| `cohere` | Cohere (`command-a-plus-05-2026`); supports `$COHERE_API_KEY` |
| `opencode` | OpenCode Zen (`deepseek-v4-flash-free`) — $0 free SKU |
| `groq` | Groq API (`openai/gpt-oss-120b`); supports `$GROQ_API_KEY` |
| `openrouter` | OpenRouter aggregator (`deepseek/deepseek-v4-flash`); supports `$OPENROUTER_API_KEY` |
| `moonshot` | Kimi K2.x (`kimi-k2.6`); supports `$MOONSHOT_API_KEY` |
| `ollama` | Local $0, no key — needs `--model` and a local 14B+ model |

Key sources, in priority order: `--api-key` flag → provider-specific environment variables (`$OPENAI_API_KEY`, `$ANTHROPIC_API_KEY`, `$DEEPSEEK_API_KEY`, etc.) → `.character-graph.config.json` (`apiKey` or `geminiApiKey`).

### Graceful Skip & Ignore Handling
- **`--disable` / `--skip`** (or `"disabled": true` in `.character-graph.config.json`): Bypasses the LLM call entirely and outputs the prompt file for manual inspection/use.
- **Missing API key handling**: If a provider requires an API key and none is found, the process gracefully logs a message, saves the prompt file, and finishes without crashing.
- **`--ignore-invalid-key` / `--ignore-error`**: If an invalid key, 401/403 authentication error, or network error occurs during the LLM call, it logs a warning and exits cleanly code 0.

### Status

Ran end-to-end once against a real episode via OpenCode Zen's
`laguna-s-2.1-free` model: produced a schema-valid graph (11 characters, 63
forms-of-address entries) at $0 cost. Manual review against the raw source
track found real extraction defects worth fixing in the next iteration
(missed a dialogue-explained naming-negotiation scene entirely, one
duplicated entry, one reversed `usedBy`/`usedFor`) — the prompt/schema are
still being iterated on before this gets wired into the app.

**Not yet done:**
- Feeding the graph into the actual line-by-line translation pipeline
  (`pipeline.ts`) as a consistency reference — currently this only produces
  the graph JSON, nothing consumes it yet.
- The per-file preview/edit UI for reviewing a graph before it's used to
  translate (a locked-in requirement for when this gets integrated, not
  built yet).
- Season-level merging of per-episode graphs for recurring characters.
