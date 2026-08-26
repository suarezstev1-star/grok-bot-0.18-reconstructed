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
