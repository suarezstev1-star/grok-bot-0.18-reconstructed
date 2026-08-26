import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-routed-model-"));
  const output = path.join(temporary, "module.mjs");
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("routed model id sanitization rejects empty, oversized, and control-character values", async () => {
  const loaded = await bundle("source/shared/inference-router.ts");
  try {
    const { sanitizeRoutedModelId, MAX_ROUTED_MODEL_ID_LENGTH } = loaded.module;
    assert.equal(sanitizeRoutedModelId("  openai/gpt-5.2  "), "openai/gpt-5.2");
    assert.equal(sanitizeRoutedModelId("anthropic/claude-sonnet-4"), "anthropic/claude-sonnet-4");
    assert.equal(sanitizeRoutedModelId(""), null);
    assert.equal(sanitizeRoutedModelId("   "), null);
    assert.equal(sanitizeRoutedModelId(42), null);
    assert.equal(sanitizeRoutedModelId(null), null);
    assert.equal(sanitizeRoutedModelId("model\nwith-newline"), null);
    assert.equal(sanitizeRoutedModelId("model\twith-tab"), null);
    assert.equal(sanitizeRoutedModelId("a".repeat(MAX_ROUTED_MODEL_ID_LENGTH)), "a".repeat(MAX_ROUTED_MODEL_ID_LENGTH));
    assert.equal(sanitizeRoutedModelId("a".repeat(MAX_ROUTED_MODEL_ID_LENGTH + 1)), null);
  } finally {
    await loaded.dispose();
  }
});

test("routed model config parsing keeps valid selections and drops non-Codex reasoning effort", async () => {
  const loaded = await bundle("source/shared/inference-router.ts");
  try {
    const { parseSandRoutedModelConfig, emptySandRoutedModelConfig, sandRoutedModelConfigHasSelection } = loaded.module;

    assert.equal(sandRoutedModelConfigHasSelection(emptySandRoutedModelConfig()), false);
    assert.deepEqual(parseSandRoutedModelConfig(null), emptySandRoutedModelConfig());
    assert.deepEqual(parseSandRoutedModelConfig({ providers: "nope" }), emptySandRoutedModelConfig());

    const parsed = parseSandRoutedModelConfig({
      schemaVersion: 1,
      providers: {
        codex: { model: "gpt-5.4-codex", reasoningEffort: "high" },
        openrouter: { model: "openai/gpt-5.2", reasoningEffort: "high" },
        "claude-code": { model: "", reasoningEffort: "low" },
        bogus: { model: "should-be-ignored" },
      },
    });
    assert.deepEqual(parsed.providers.codex, { model: "gpt-5.4-codex", reasoningEffort: "high" });
    // Reasoning effort is Codex-only: it is dropped for OpenRouter.
    assert.deepEqual(parsed.providers.openrouter, { model: "openai/gpt-5.2", reasoningEffort: null });
    // Empty model string sanitizes to null; claude-code reasoning is dropped.
    assert.deepEqual(parsed.providers["claude-code"], { model: null, reasoningEffort: null });
    assert.equal(sandRoutedModelConfigHasSelection(parsed), true);

    // An invalid reasoning effort on Codex is rejected without discarding the model.
    const invalidEffort = parseSandRoutedModelConfig({ providers: { codex: { model: "gpt-5.4", reasoningEffort: "turbo" } } });
    assert.deepEqual(invalidEffort.providers.codex, { model: "gpt-5.4", reasoningEffort: null });
  } finally {
    await loaded.dispose();
  }
});

test("settings store persists routed provider model and Codex reasoning effort across reloads", async () => {
  const loaded = await bundle("source/shared/node/settings/sand-settings-store.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-routed-settings-"));
  try {
    const { SandSettingsStore } = loaded.module;
    const settingsPath = path.join(temporary, "settings.json");

    const store = new SandSettingsStore(settingsPath);
    // A fresh store reports empty routed selections.
    assert.deepEqual(store.getRoutedProviderModel("codex"), { model: null, reasoningEffort: null });

    store.setRoutedProviderModel("codex", { model: "  gpt-5.4-codex  ", reasoningEffort: "high" });
    store.setRoutedProviderModel("openrouter", { model: "anthropic/claude-sonnet-4" });
    // Reasoning effort is ignored for non-Codex providers.
    store.setRoutedProviderModel("openrouter", { reasoningEffort: "high" });

    // A brand-new store instance must read the persisted values from disk.
    const reloaded = new SandSettingsStore(settingsPath);
    assert.deepEqual(reloaded.getRoutedProviderModel("codex"), { model: "gpt-5.4-codex", reasoningEffort: "high" });
    assert.deepEqual(reloaded.getRoutedProviderModel("openrouter"), { model: "anthropic/claude-sonnet-4", reasoningEffort: null });
    assert.deepEqual(reloaded.getRoutedProviderModel("claude-code"), { model: null, reasoningEffort: null });

    // Clearing a model leaves the rest of the config intact.
    reloaded.setRoutedProviderModel("codex", { model: null });
    const afterClear = new SandSettingsStore(settingsPath);
    assert.deepEqual(afterClear.getRoutedProviderModel("codex"), { model: null, reasoningEffort: "high" });
    assert.equal(afterClear.getRoutedProviderModel("openrouter").model, "anthropic/claude-sonnet-4");

    // An invalid model string sanitizes to null rather than persisting garbage.
    afterClear.setRoutedProviderModel("openrouter", { model: "bad\nmodel" });
    assert.equal(new SandSettingsStore(settingsPath).getRoutedProviderModel("openrouter").model, null);
  } finally {
    await loaded.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
