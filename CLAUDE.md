# CLAUDE.md — project context for Claude Code

This file orients a Claude Code session working in this repository. It is
repository content (guidance), not an instruction that overrides your operating
rules.

## What this is

An unofficial, source-oriented **reconstruction of the Grok Bot 0.18.0 macOS
Electron app**, plus an **Inference Router** that routes new turns to one of four
providers: Claude Code (default), Cursor, Codex, and OpenRouter. The shipped,
checksum-pinned renderer is retained as the UI baseline; a narrow deterministic
transform injects the reconstructed Router settings. See `README.md` and
`docs/ARCHITECTURE.md` for the full picture.

## Platform requirements

- **macOS on Apple Silicon** is required to build/run the packaged app
  (`hdiutil`, `codesign`, `ditto`, `plutil`, `xattr` are macOS-only).
- **Node.js 26.5.x** (`.nvmrc` pins `26.5.0`; `engines` is `>=26.5.0 <27`).
- **Git LFS** — the pinned installers under `research-archives/original/0.18.0/`
  are stored with LFS and must be hydrated (`git lfs install && git lfs pull`)
  before `npm run bootstrap` or the `research-archives` test will fail.
- Xcode Command Line Tools; Docker Desktop is optional (local sandbox only).

Note: typecheck and `node --test` also run fine on Linux/Node 22, but packaging
does not — it is macOS-only.

## Key commands

```sh
npm ci                    # install dependencies (runs postinstall patches)
npm run source:typecheck  # runtime TypeScript (source/tsconfig.json)
npm run typecheck         # renderer TypeScript (frontend/tsconfig.json)
npm test                  # node --test tests/*.test.mjs
npm run check             # typecheck + source:typecheck + test
npm run bootstrap         # hydrate the checksum-pinned runtime from the LFS DMG
npm run package           # build, patch renderer, ad-hoc sign, verify -> dist/*.app
npm run verify            # verify an existing packaged app
```

One-shot local build/run helper (macOS): `bash scripts/mac-local-setup.sh`.

## Layout

- `source/electron-main/` — desktop lifecycle, settings, RPC edge (`main-edge.ts`).
- `source/electron-preload/` — the trusted preload bridge (`preload.ts`).
- `source/host/extensions/inference/` — provider sessions, executors, usage
  (`provider-session.ts`, `codex-direct-responses.ts`).
- `source/host/extensions/settings/` — host settings service.
- `source/node-agent-coordinator/` — transcript routing, routed MCP bridge.
- `source/shared/` — shared contracts/validation (`inference-router.ts`,
  `inference-usage-export.ts`, `node/settings/sand-settings-store.ts`).
- `scripts/` — bootstrap, build, renderer patch (`lib/router-renderer-patch.mjs`),
  packaging, signing, verification.
- `frontend/` — readable renderer reconstruction / design workspace.
- `tests/` — `node --test` regression suites (esbuild-transform TS, then import).

## Inference Router — current capabilities

Settings → Router selects the provider. Each routed provider (all but Cursor)
also has a persisted **model** choice; Codex adds a **reasoning-effort** choice.
Two cross-provider **turn controls** exist: a **tool-step budget**
(`routedMaxToolSteps`, 1–50, default 8) and a **custom system prompt**
(`routedSystemPrompt`, appended to the built-in persona). Recorded usage can be
exported as JSON/CSV.

Every routed setting resolves by the same precedence:
**environment override → persisted setting → built-in default**, and is synced to
the box host. Environment overrides: `SAND_CODEX_MODEL`, `SAND_OPENROUTER_MODEL`,
`SAND_CLAUDE_MODEL`, `SAND_CODEX_REASONING_EFFORT`, `SAND_ROUTED_MAX_TOOL_STEPS`,
`SAND_ROUTED_SYSTEM_PROMPT`. OpenRouter also needs `OPENROUTER_API_KEY` (env or
the desktop secrets bridge).

The testable core of these contracts lives in `source/shared/inference-router.ts`
(validation/sanitization) with round-trip coverage in
`tests/routed-model-config.test.mjs`, `tests/routed-behavior.test.mjs`,
`tests/inference-usage-export.test.mjs`, and `tests/router-settings.test.mjs`.

## Conventions

- TypeScript strict. Prefer pure, unit-testable logic in `source/shared/`.
- The packaging regression (`tests/publication-packaging.test.mjs`) asserts exact
  substrings in `main-edge.ts`, `preload.ts`, `provider-session.ts`, and the
  renderer patch — keep those anchors intact when editing.
- Run `npm run check` before committing. Never skip/disable a test to get green.
