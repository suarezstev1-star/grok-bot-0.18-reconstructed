# Local handoff — continue on your Mac

This branch was developed in a remote Linux session (which cannot build/run the
macOS app). This document hands the work off to a **local Claude Code session on
your Mac**, where the packaged app can be built and launched.

- **Branch:** `claude/desarrollalo-sefofu`
- **Open PR:** #1 (draft) — `suarezstev1-star/grok-bot-0.18-reconstructed`
- **State:** all code complete and green (`npm run check` passes); only the
  macOS build/run remains, which is what you do locally.

## 1. Get the branch on your Mac

```sh
# Prerequisites (once):
xcode-select --install
brew install git-lfs && git lfs install
nvm install 26.5.0 && nvm use        # Node 26.5.x (see .nvmrc)

# If already cloned:
cd grok-bot-0.18-reconstructed
git fetch origin claude/desarrollalo-sefofu
git checkout claude/desarrollalo-sefofu
git pull origin claude/desarrollalo-sefofu

# If not cloned yet:
git clone https://github.com/suarezstev1-star/grok-bot-0.18-reconstructed.git
cd grok-bot-0.18-reconstructed
git checkout claude/desarrollalo-sefofu
```

## 2. Build and run — one command

```sh
bash scripts/mac-local-setup.sh
```

This hydrates the Git LFS installers, runs `npm ci`, `npm run bootstrap`,
`npm run check`, `npm run package`, and opens the app. Flags:
`--no-open` (build only) and `--no-package` (stop after checks).

### Or run the steps manually
```sh
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
open "dist/Grok Bot 0.18 Reconstructed.app"
```

## 3. Continue the work in a local Claude Code session

From the repo root on your Mac:

```sh
claude
```

The session reads `CLAUDE.md` for project context automatically. Good opening
prompts:

- "Run `bash scripts/mac-local-setup.sh` and fix anything that fails."
- "Package the app and confirm Settings → Router shows the Model control."
- "Implement per-model usage breakdown" or "add cost estimation" (see Roadmap).

## 4. Try the features after launch

- **Settings → Router**: pick a provider, then a **Model** (and, for Codex, a
  reasoning effort). Blank = provider default.
- **Turn controls / powers** (env overrides, or persist via settings):
  ```sh
  SAND_ROUTED_MAX_TOOL_STEPS=20 \
  SAND_ROUTED_SYSTEM_PROMPT="Answer in Spanish, briefly." \
  open "dist/Grok Bot 0.18 Reconstructed.app"
  ```
- **OpenRouter** needs `OPENROUTER_API_KEY` (env or the in-app secrets bridge).

## 5. What was built on this branch

- Per-provider **model selection** (+ Codex reasoning effort), persisted and
  box-synced, with a **Model** control on the Router page.
- **Routed turn controls**: tool-step budget (`routedMaxToolSteps`) and custom
  system prompt (`routedSystemPrompt`).
- **Usage export** (JSON/CSV) via `exportRoutedUsage`.
- Readable-reconstruction parity in `frontend/` and full `node --test` coverage.

## Roadmap (not yet implemented)

- **Cost estimation** per provider/model — needs a real price table you supply.
- **Per-model usage breakdown** — additive change to the usage schema.

## Troubleshooting

- `bootstrap` "Archived DMG checksum mismatch … Run git lfs pull" → run
  `git lfs pull` (and ensure `git lfs install` ran once).
- LFS files still ~134 bytes → `brew install git-lfs && git lfs install`, retry.
- Gatekeeper blocks the ad-hoc-signed app → *Settings → Privacy & Security →
  Open Anyway*, or `xattr -dr com.apple.quarantine "dist/Grok Bot 0.18 Reconstructed.app"`.
- Node complaints → confirm `node -v` is 26.5.x (`nvm use`).
