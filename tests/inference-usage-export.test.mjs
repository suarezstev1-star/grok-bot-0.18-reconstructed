import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-usage-export-"));
  const output = path.join(temporary, "module.mjs");
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function provider(requests, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, lastUsedAt) {
  return { requests, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, lastUsedAt };
}

const USAGE = {
  schemaVersion: 1,
  providers: {
    cursor: provider(3, 0, 0, 0, 0, "2026-01-02T00:00:00.000Z"),
    "claude-code": provider(2, 100, 50, 10, 5, "2026-01-01T00:00:00.000Z"),
    codex: provider(1, 1000, 200, 0, 0, null),
    openrouter: provider(0, 0, 0, 0, 0, null),
  },
};

test("routed usage rows annotate each provider with its default model and totals", async () => {
  const loaded = await bundle("source/shared/inference-usage-export.ts");
  try {
    const { routedUsageRows } = loaded.module;
    const rows = routedUsageRows(USAGE);
    assert.deepEqual(rows.map((r) => r.provider), ["cursor", "claude-code", "codex", "openrouter"]);
    // Cursor is not a routed provider: no model.
    assert.equal(rows[0].model, null);
    // Routed providers fall back to the built-in default model when unset.
    assert.equal(rows[1].model, null); // claude-code default is the CLI login default (null)
    assert.equal(rows[2].model, "gpt-5.4");
    assert.equal(rows[3].model, "openai/gpt-5.2");
    // totalTokens sums input+output+cacheRead+cacheWrite.
    assert.equal(rows[1].totalTokens, 165);
    assert.equal(rows[2].totalTokens, 1200);
  } finally {
    await loaded.dispose();
  }
});

test("a selected model config overrides the default in the export rows", async () => {
  const loaded = await bundle("source/shared/inference-usage-export.ts");
  try {
    const { routedUsageRows } = loaded.module;
    const models = { schemaVersion: 1, providers: { "claude-code": { model: null, reasoningEffort: null }, codex: { model: "gpt-5.4-codex", reasoningEffort: "high" }, openrouter: { model: "anthropic/claude-sonnet-4", reasoningEffort: null } } };
    const rows = routedUsageRows(USAGE, models);
    assert.equal(rows[2].model, "gpt-5.4-codex");
    assert.equal(rows[3].model, "anthropic/claude-sonnet-4");
  } finally {
    await loaded.dispose();
  }
});

test("usage exports to valid JSON and CSV", async () => {
  const loaded = await bundle("source/shared/inference-usage-export.ts");
  try {
    const { formatRoutedUsageJson, formatRoutedUsageCsv } = loaded.module;

    const json = formatRoutedUsageJson(USAGE);
    const parsed = JSON.parse(json);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.providers.length, 4);
    assert.equal(parsed.providers[2].provider, "codex");
    assert.equal(parsed.providers[2].totalTokens, 1200);

    const csv = formatRoutedUsageCsv(USAGE);
    const lines = csv.trimEnd().split("\r\n");
    assert.equal(lines[0], "provider,model,requests,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,lastUsedAt");
    assert.equal(lines.length, 5);
    assert.equal(lines[3], "codex,gpt-5.4,1,1000,200,0,0,1200,");
    assert.equal(lines[2], "claude-code,,2,100,50,10,5,165,2026-01-01T00:00:00.000Z");
  } finally {
    await loaded.dispose();
  }
});

test("CSV cells with commas or quotes are escaped", async () => {
  const loaded = await bundle("source/shared/inference-usage-export.ts");
  try {
    const { formatRoutedUsageCsv } = loaded.module;
    const models = { schemaVersion: 1, providers: { "claude-code": { model: null, reasoningEffort: null }, codex: { model: 'weird,"model', reasoningEffort: null }, openrouter: { model: null, reasoningEffort: null } } };
    const csv = formatRoutedUsageCsv(USAGE, models);
    assert.match(csv, /"weird,""model"/);
  } finally {
    await loaded.dispose();
  }
});
