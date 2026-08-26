import assert from "node:assert/strict";
import test from "node:test";

import { patchOriginalSettingsRegistry, patchOriginalSettingsPanel } from "../scripts/lib/router-renderer-patch.mjs";

// Minimal synthetic chunks that carry the exact anchors the packaging step looks
// for in the shipped renderer. The real chunk discovery is covered by
// publication-packaging.test.mjs; here we exercise the transforms themselves.
const REGISTRY_SOURCE =
  'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}];';
const PANEL_SOURCE = [
  'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):null;',
  'Z=x==="usage"?a.jsx(Te,{children:a.jsx(Na,{})}):null;',
  "function Sa(s){return null}",
].join("\n");

test("settings registry patch inserts the Router tab between General and Usage", () => {
  const patched = patchOriginalSettingsRegistry(REGISTRY_SOURCE);
  assert.match(patched, /\{id:"router",label:"Router",icon:"git-branch"\}/);
  // The Router tab lands after General and before Usage.
  assert.ok(patched.indexOf('id:"general"') < patched.indexOf('id:"router"'));
  assert.ok(patched.indexOf('id:"router"') < patched.indexOf('id:"usage"'));
});

test("settings panel patch injects the Model control and reroutes the tabs", () => {
  const patched = patchOriginalSettingsPanel(PANEL_SOURCE);

  // The reconstructed components are injected ahead of the original anchor.
  assert.match(patched, /function RRouterModel\(/);
  assert.match(patched, /function RRouterPanel\(/);
  assert.ok(patched.indexOf("function RRouterPanel(") < patched.indexOf("function Sa(s){"));

  // The Model section is wired into the panel for every routed (non-cursor) provider.
  assert.match(patched, /r\.value!=="cursor"\?a\.jsx\(re,\{title:"Model"/);
  assert.match(patched, /a\.jsx\(RRouterModel,\{provider:r,state:s\}\)/);

  // Codex carries a reasoning-effort selector; other providers only the model id.
  assert.match(patched, /RRouterReasoningOptions/);
  assert.match(patched, /supportsReasoning/);

  // Saving routes through the object-form setInferenceRouter RPC.
  assert.match(patched, /window\.desktop\.agent\.setInferenceRouter\(m\)/);
  // Saving broadcasts the shared provider-changed event so the panel/usage views resync.
  assert.match(patched, /new CustomEvent\("sand-router-provider-changed"/);

  // The tab switches now render the reconstructed panels.
  assert.match(patched, /x==="router"\?a\.jsx\(RRouterPanel,\{\}\)/);
  assert.match(patched, /x==="usage"\?a\.jsx\(Te,\{children:a\.jsx\(RRouterUsage,\{\}\)\}\)/);

  // The injected component block parses as valid JavaScript.
  const start = patched.indexOf("const RRouterProviders=");
  const end = patched.indexOf("function Sa(s){");
  assert.ok(start >= 0 && end > start, "injected component block is present");
  assert.doesNotThrow(() => new Function(patched.slice(start, end)));
});

test("both patches are anchored: re-applying throws instead of double-injecting", () => {
  const registry = patchOriginalSettingsRegistry(REGISTRY_SOURCE);
  assert.throws(() => patchOriginalSettingsRegistry(registry), /registry/);

  const panel = patchOriginalSettingsPanel(PANEL_SOURCE);
  assert.throws(() => patchOriginalSettingsPanel(panel), /Router panel switch|Usage panel switch|component insertion/);
});
