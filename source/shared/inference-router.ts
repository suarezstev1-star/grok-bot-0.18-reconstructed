export const SAND_INFERENCE_PROVIDERS = ["cursor", "claude-code", "codex", "openrouter"] as const;
export type SandInferenceProvider = (typeof SAND_INFERENCE_PROVIDERS)[number];

export interface SandInferenceRouterUsageProvider {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly lastUsedAt: string | null;
}

export interface SandInferenceRouterUsage {
  readonly schemaVersion: 1;
  readonly providers: Record<SandInferenceProvider, SandInferenceRouterUsageProvider>;
}

export function isSandInferenceProvider(value: unknown): value is SandInferenceProvider {
  return typeof value === "string" && (SAND_INFERENCE_PROVIDERS as readonly string[]).includes(value);
}

// The provider a fresh install routes new turns through before the user picks
// one in Settings → Router. Claude Code is the default so the app boots on the
// routed Claude Code path rather than Cursor.
export const DEFAULT_SAND_INFERENCE_PROVIDER: SandInferenceProvider = "claude-code";

export function emptySandInferenceRouterUsage(): SandInferenceRouterUsage {
  const empty = (): SandInferenceRouterUsageProvider => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsedAt: null });
  return { schemaVersion: 1, providers: { cursor: empty(), "claude-code": empty(), codex: empty(), openrouter: empty() } };
}

// Routed providers are every inference provider except Cursor. Cursor uses the
// native model-selection surface, so per-provider routed model configuration
// only applies to the directly-transported providers.
export const SAND_ROUTED_INFERENCE_PROVIDERS = ["claude-code", "codex", "openrouter"] as const;
export type SandRoutedInferenceProvider = (typeof SAND_ROUTED_INFERENCE_PROVIDERS)[number];

export function isSandRoutedInferenceProvider(value: unknown): value is SandRoutedInferenceProvider {
  return typeof value === "string" && (SAND_ROUTED_INFERENCE_PROVIDERS as readonly string[]).includes(value);
}

// Reasoning effort is a Codex-only knob mirrored from its `config.toml`.
export const SAND_CODEX_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type SandCodexReasoningEffort = (typeof SAND_CODEX_REASONING_EFFORTS)[number];

export function isSandCodexReasoningEffort(value: unknown): value is SandCodexReasoningEffort {
  return typeof value === "string" && (SAND_CODEX_REASONING_EFFORTS as readonly string[]).includes(value);
}

// A null model means "let the provider pick its own default" (the Claude Code
// CLI login default, or the built-in Codex/OpenRouter default identifiers).
export const DEFAULT_ROUTED_PROVIDER_MODEL: Record<SandRoutedInferenceProvider, string | null> = {
  "claude-code": null,
  codex: "gpt-5.4",
  openrouter: "openai/gpt-5.2",
};

export const MAX_ROUTED_MODEL_ID_LENGTH = 200;

export interface SandRoutedProviderModelConfig {
  readonly model: string | null;
  readonly reasoningEffort: SandCodexReasoningEffort | null;
}

export interface SandRoutedModelConfig {
  readonly schemaVersion: 1;
  readonly providers: Record<SandRoutedInferenceProvider, SandRoutedProviderModelConfig>;
}

export function emptySandRoutedModelConfig(): SandRoutedModelConfig {
  const empty = (): SandRoutedProviderModelConfig => ({ model: null, reasoningEffort: null });
  return { schemaVersion: 1, providers: { "claude-code": empty(), codex: empty(), openrouter: empty() } };
}

// A model id must be a single-line, control-character-free, bounded string.
// Anything else is treated as "unset" so a corrupt persisted value can never
// leak into a provider request.
export function sanitizeRoutedModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ROUTED_MODEL_ID_LENGTH) return null;
  // Reject C0/C1 control characters (including newlines and tabs) so a model id
  // can never smuggle header- or prompt-breaking bytes into a provider request.
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return null;
  }
  return trimmed;
}

export function parseSandRoutedModelConfig(value: unknown): SandRoutedModelConfig {
  const config = emptySandRoutedModelConfig();
  if (typeof value !== "object" || value == null || Array.isArray(value)) return config;
  const providers = (value as { providers?: unknown }).providers;
  if (typeof providers !== "object" || providers == null || Array.isArray(providers)) return config;
  for (const provider of SAND_ROUTED_INFERENCE_PROVIDERS) {
    const raw = (providers as Record<string, unknown>)[provider];
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const model = sanitizeRoutedModelId(record.model);
    // Reasoning effort is only meaningful for Codex; drop it for other providers.
    const reasoningEffort = provider === "codex" && isSandCodexReasoningEffort(record.reasoningEffort) ? record.reasoningEffort : null;
    config.providers[provider] = { model, reasoningEffort };
  }
  return config;
}

// Whether a routed model config carries any non-default selection. Used to
// avoid persisting an all-empty object.
export function sandRoutedModelConfigHasSelection(config: SandRoutedModelConfig): boolean {
  return SAND_ROUTED_INFERENCE_PROVIDERS.some((provider) => {
    const entry = config.providers[provider];
    return entry.model != null || entry.reasoningEffort != null;
  });
}

// --- Routed turn behavior -------------------------------------------------
//
// Cross-provider knobs that shape how a routed turn runs, independent of the
// chosen model: how many tool-use steps a single turn may take, and an optional
// user addition to the built-in system prompt.

// The maximum number of tool-use steps a routed turn may take before it must
// answer. Kept bounded so a runaway tool loop can never spin without limit.
export const DEFAULT_ROUTED_MAX_TOOL_STEPS = 8;
export const MIN_ROUTED_MAX_TOOL_STEPS = 1;
export const MAX_ROUTED_MAX_TOOL_STEPS = 50;

export function sanitizeRoutedMaxToolSteps(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < MIN_ROUTED_MAX_TOOL_STEPS || value > MAX_ROUTED_MAX_TOOL_STEPS) return null;
  return value;
}

// An optional user addition to the built-in routed system prompt. Bounded, and
// stripped of C0/C1 control characters (except tab and newline) so it can never
// smuggle prompt- or protocol-breaking bytes into a provider request.
export const MAX_ROUTED_SYSTEM_PROMPT_LENGTH = 4000;

export function sanitizeRoutedSystemPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let cleaned = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x09 || code === 0x0a) { cleaned += value[index]; continue; }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    cleaned += value[index];
  }
  const trimmed = cleaned.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_ROUTED_SYSTEM_PROMPT_LENGTH ? trimmed.slice(0, MAX_ROUTED_SYSTEM_PROMPT_LENGTH) : trimmed;
}
