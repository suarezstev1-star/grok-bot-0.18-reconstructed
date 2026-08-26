import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerSourcePath = path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/router.ts");

async function loadRouterModule() {
  const source = await readFile(routerSourcePath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("router provider preference defaults to Cursor and round-trips every provider", async () => {
  const router = await loadRouterModule();
  assert.deepEqual(router.ROUTER_PROVIDERS.map(({ id }) => id), ["cursor", "claude-code", "codex", "openrouter"]);
  assert.equal(router.parseRouterProviderPreference(null), "cursor");
  assert.equal(router.parseRouterProviderPreference("not-json"), "cursor");
  assert.equal(router.parseRouterProviderPreference(JSON.stringify({ schemaVersion: 1, provider: "unknown" })), "cursor");

  let stored = null;
  const persistence = {
    async read(key) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      return stored;
    },
    async write(key, value) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      stored = value;
    }
  };
  for (const provider of router.ROUTER_PROVIDERS) {
    await router.saveRouterProvider(persistence, provider.id);
    assert.equal(await router.loadRouterProvider(persistence), provider.id);
  }
});

test("settings registry exposes Router with the native settings icon contract", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  assert.match(source, /\{ id: "router", label: "Router", icon: "git-branch" \}/);
});

test("routed providers are every provider except Cursor, with matching defaults", async () => {
  const router = await loadRouterModule();
  assert.deepEqual([...router.ROUTED_ROUTER_PROVIDERS], ["claude-code", "codex", "openrouter"]);
  assert.equal(router.isRoutedRouterProviderId("cursor"), false);
  assert.equal(router.isRoutedRouterProviderId("codex"), true);
  assert.deepEqual(router.DEFAULT_ROUTED_MODEL, { "claude-code": null, codex: "gpt-5.4", openrouter: "openai/gpt-5.2" });
  // The provider metadata agrees with the default table.
  for (const provider of router.ROUTER_PROVIDERS) {
    if (provider.id === "cursor") continue;
    assert.equal(provider.defaultModel, router.DEFAULT_ROUTED_MODEL[provider.id]);
  }
  assert.equal(router.ROUTER_PROVIDERS.find((p) => p.id === "codex").supportsReasoning, true);
  assert.equal(router.ROUTER_PROVIDERS.find((p) => p.id === "openrouter").supportsReasoning, undefined);
});

test("router model id sanitization rejects empty, oversized, and control-character values", async () => {
  const router = await loadRouterModule();
  const { sanitizeRouterModelId, MAX_ROUTER_MODEL_ID_LENGTH } = router;
  assert.equal(sanitizeRouterModelId("  openai/gpt-5.2  "), "openai/gpt-5.2");
  assert.equal(sanitizeRouterModelId(""), null);
  assert.equal(sanitizeRouterModelId("   "), null);
  assert.equal(sanitizeRouterModelId(42), null);
  assert.equal(sanitizeRouterModelId(null), null);
  assert.equal(sanitizeRouterModelId("model\nwith-newline"), null);
  assert.equal(sanitizeRouterModelId("model\twith-tab"), null);
  assert.equal(sanitizeRouterModelId("a".repeat(MAX_ROUTER_MODEL_ID_LENGTH)), "a".repeat(MAX_ROUTER_MODEL_ID_LENGTH));
  assert.equal(sanitizeRouterModelId("a".repeat(MAX_ROUTER_MODEL_ID_LENGTH + 1)), null);
});

test("router model config parsing keeps valid selections and drops non-Codex reasoning effort", async () => {
  const router = await loadRouterModule();
  const { parseRouterModelConfig, emptyRouterModelConfig, routerModelConfigHasSelection, parseRouterModelPreference } = router;

  assert.equal(routerModelConfigHasSelection(emptyRouterModelConfig()), false);
  assert.deepEqual(parseRouterModelConfig(null), emptyRouterModelConfig());
  assert.deepEqual(parseRouterModelConfig({ providers: "nope" }), emptyRouterModelConfig());
  assert.deepEqual(parseRouterModelPreference("not-json"), emptyRouterModelConfig());

  const parsed = parseRouterModelConfig({
    schemaVersion: 1,
    providers: {
      codex: { model: "gpt-5.4-codex", reasoningEffort: "high" },
      openrouter: { model: "openai/gpt-5.2", reasoningEffort: "high" },
      "claude-code": { model: "", reasoningEffort: "low" },
      bogus: { model: "should-be-ignored" }
    }
  });
  assert.deepEqual(parsed.providers.codex, { model: "gpt-5.4-codex", reasoningEffort: "high" });
  assert.deepEqual(parsed.providers.openrouter, { model: "openai/gpt-5.2", reasoningEffort: null });
  assert.deepEqual(parsed.providers["claude-code"], { model: null, reasoningEffort: null });
  assert.equal(routerModelConfigHasSelection(parsed), true);

  const invalidEffort = parseRouterModelConfig({ providers: { codex: { model: "gpt-5.4", reasoningEffort: "turbo" } } });
  assert.deepEqual(invalidEffort.providers.codex, { model: "gpt-5.4", reasoningEffort: null });
});

test("setRouterProviderModel patches one provider with keep/clear/sanitize semantics", async () => {
  const router = await loadRouterModule();
  const { emptyRouterModelConfig, setRouterProviderModel, effectiveRouterModel } = router;

  let config = emptyRouterModelConfig();
  config = setRouterProviderModel(config, "codex", { model: "  gpt-5.4-codex  ", reasoningEffort: "high" });
  assert.deepEqual(config.providers.codex, { model: "gpt-5.4-codex", reasoningEffort: "high" });

  // Reasoning effort is ignored for non-Codex providers.
  config = setRouterProviderModel(config, "openrouter", { model: "anthropic/claude-sonnet-4", reasoningEffort: "high" });
  assert.deepEqual(config.providers.openrouter, { model: "anthropic/claude-sonnet-4", reasoningEffort: null });

  // Omitting a field keeps it; clearing the model leaves reasoning intact.
  config = setRouterProviderModel(config, "codex", { model: null });
  assert.deepEqual(config.providers.codex, { model: null, reasoningEffort: "high" });

  // An invalid model string sanitizes to null.
  config = setRouterProviderModel(config, "openrouter", { model: "bad\nmodel" });
  assert.equal(config.providers.openrouter.model, null);

  // Effective model falls back to the built-in default when unset.
  assert.equal(effectiveRouterModel(config, "codex"), "gpt-5.4");
  assert.equal(effectiveRouterModel(config, "openrouter"), "openai/gpt-5.2");
  assert.equal(effectiveRouterModel(config, "claude-code"), null);
  config = setRouterProviderModel(config, "claude-code", { model: "claude-opus-4" });
  assert.equal(effectiveRouterModel(config, "claude-code"), "claude-opus-4");
});

test("router model selection round-trips through client persistence", async () => {
  const router = await loadRouterModule();
  let stored = null;
  const persistence = {
    async read(key) {
      assert.equal(key, router.ROUTER_MODEL_PERSISTENCE_KEY);
      return stored;
    },
    async write(key, value) {
      assert.equal(key, router.ROUTER_MODEL_PERSISTENCE_KEY);
      stored = value;
    }
  };

  // A fresh persistence reports an empty config.
  assert.deepEqual(await router.loadRouterModel(persistence), router.emptyRouterModelConfig());

  let config = router.setRouterProviderModel(router.emptyRouterModelConfig(), "codex", { model: "gpt-5.4-codex", reasoningEffort: "medium" });
  config = router.setRouterProviderModel(config, "openrouter", { model: "anthropic/claude-sonnet-4" });
  await router.saveRouterModel(persistence, config);

  const reloaded = await router.loadRouterModel(persistence);
  assert.deepEqual(reloaded.providers.codex, { model: "gpt-5.4-codex", reasoningEffort: "medium" });
  assert.deepEqual(reloaded.providers.openrouter, { model: "anthropic/claude-sonnet-4", reasoningEffort: null });
  assert.deepEqual(reloaded.providers["claude-code"], { model: null, reasoningEffort: null });
});
