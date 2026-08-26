import type { AgentDesktopBridge } from "../../../contracts/desktop-bridge";

export type RouterProviderId = "cursor" | "claude-code" | "codex" | "openrouter";

export interface RouterProvider {
  readonly id: RouterProviderId;
  readonly label: string;
  readonly description: string;
  readonly usageDescription: string;
  readonly usageSource: "cursor" | "external";
  /** Built-in model used when no model is selected. Routed providers only; `null` means the provider's own login default. */
  readonly defaultModel?: string | null;
  /** Whether the provider exposes a reasoning-effort knob (Codex only). */
  readonly supportsReasoning?: boolean;
}

export const DEFAULT_ROUTER_PROVIDER: RouterProviderId = "cursor";
export const ROUTER_PROVIDER_PERSISTENCE_KEY = "settings.router-provider.v1";

export const ROUTER_PROVIDERS: readonly RouterProvider[] = [
  {
    id: "cursor",
    label: "Cursor",
    description: "Use your signed-in Cursor account and its hosted agent models.",
    usageDescription: "Included and on-demand usage from your Cursor account.",
    usageSource: "cursor"
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Use Anthropic's Claude Code provider for agent requests.",
    usageDescription: "Claude Code usage is managed by your Anthropic account and is not exposed as an in-app meter.",
    usageSource: "external",
    defaultModel: null
  },
  {
    id: "codex",
    label: "Codex",
    description: "Use OpenAI's Codex provider for agent requests.",
    usageDescription: "Codex usage is managed by your OpenAI account and is not exposed as an in-app meter.",
    usageSource: "external",
    defaultModel: "gpt-5.4",
    supportsReasoning: true
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Use models and billing from your OpenRouter account.",
    usageDescription: "OpenRouter usage and spend are managed in your OpenRouter account and are not exposed as an in-app meter.",
    usageSource: "external",
    defaultModel: "openai/gpt-5.2"
  }
];

const ROUTER_PROVIDER_IDS = new Set<RouterProviderId>(ROUTER_PROVIDERS.map((provider) => provider.id));

export function isRouterProviderId(value: unknown): value is RouterProviderId {
  return typeof value === "string" && ROUTER_PROVIDER_IDS.has(value as RouterProviderId);
}

export function routerProviderById(id: RouterProviderId): RouterProvider {
  return ROUTER_PROVIDERS.find((provider) => provider.id === id) ?? ROUTER_PROVIDERS[0]!;
}

export function parseRouterProviderPreference(raw: string | null): RouterProviderId {
  if (raw == null) return DEFAULT_ROUTER_PROVIDER;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value == null || Array.isArray(value)) return DEFAULT_ROUTER_PROVIDER;
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1 || !isRouterProviderId(record.provider)) return DEFAULT_ROUTER_PROVIDER;
    return record.provider;
  } catch {
    return DEFAULT_ROUTER_PROVIDER;
  }
}

export type RouterProviderPersistence = Pick<AgentDesktopBridge["clientPersistence"], "read" | "write">;

export async function loadRouterProvider(persistence: RouterProviderPersistence): Promise<RouterProviderId> {
  return parseRouterProviderPreference(await persistence.read(ROUTER_PROVIDER_PERSISTENCE_KEY));
}

export async function saveRouterProvider(persistence: RouterProviderPersistence, provider: RouterProviderId): Promise<void> {
  if (!isRouterProviderId(provider)) throw new Error("Unknown router provider.");
  await persistence.write(ROUTER_PROVIDER_PERSISTENCE_KEY, JSON.stringify({ schemaVersion: 1, provider }));
}

// ---------------------------------------------------------------------------
// Per-provider model selection
//
// Mirrors the shared `SandRoutedModelConfig` contract (see
// `source/shared/inference-router.ts`) in the readable renderer reconstruction:
// every routed provider (all but Cursor) records its own model choice, and
// Codex additionally records a reasoning-effort choice. Cursor keeps using its
// native model surface, so it has no entry here.
// ---------------------------------------------------------------------------

/** Routed providers are every router provider except Cursor. */
export type RoutedRouterProviderId = Exclude<RouterProviderId, "cursor">;

export const ROUTED_ROUTER_PROVIDERS: readonly RoutedRouterProviderId[] = ["claude-code", "codex", "openrouter"];

/** Reasoning effort is a Codex-only knob mirrored from its `config.toml`. */
export type RouterReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export const ROUTER_REASONING_EFFORTS: readonly RouterReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];

/** A `null` model means "let the provider pick its own default". */
export const DEFAULT_ROUTED_MODEL: Record<RoutedRouterProviderId, string | null> = {
  "claude-code": null,
  codex: "gpt-5.4",
  openrouter: "openai/gpt-5.2"
};

export const MAX_ROUTER_MODEL_ID_LENGTH = 200;
export const ROUTER_MODEL_PERSISTENCE_KEY = "settings.router-model.v1";

export interface RouterProviderModelSelection {
  readonly model: string | null;
  readonly reasoningEffort: RouterReasoningEffort | null;
}

export interface RouterModelConfig {
  readonly schemaVersion: 1;
  readonly providers: Record<RoutedRouterProviderId, RouterProviderModelSelection>;
}

const ROUTED_ROUTER_PROVIDER_IDS = new Set<RoutedRouterProviderId>(ROUTED_ROUTER_PROVIDERS);
const ROUTER_REASONING_EFFORT_VALUES = new Set<RouterReasoningEffort>(ROUTER_REASONING_EFFORTS);

export function isRoutedRouterProviderId(value: unknown): value is RoutedRouterProviderId {
  return typeof value === "string" && ROUTED_ROUTER_PROVIDER_IDS.has(value as RoutedRouterProviderId);
}

export function isRouterReasoningEffort(value: unknown): value is RouterReasoningEffort {
  return typeof value === "string" && ROUTER_REASONING_EFFORT_VALUES.has(value as RouterReasoningEffort);
}

export function emptyRouterModelConfig(): RouterModelConfig {
  const empty = (): RouterProviderModelSelection => ({ model: null, reasoningEffort: null });
  return { schemaVersion: 1, providers: { "claude-code": empty(), codex: empty(), openrouter: empty() } };
}

/**
 * A model id must be a single-line, control-character-free, bounded string.
 * Anything else is treated as "unset" so a corrupt persisted value can never
 * leak into a provider request.
 */
export function sanitizeRouterModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ROUTER_MODEL_ID_LENGTH) return null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return null;
  }
  return trimmed;
}

export function parseRouterModelConfig(value: unknown): RouterModelConfig {
  const config = emptyRouterModelConfig();
  if (typeof value !== "object" || value == null || Array.isArray(value)) return config;
  const providers = (value as { providers?: unknown }).providers;
  if (typeof providers !== "object" || providers == null || Array.isArray(providers)) return config;
  for (const provider of ROUTED_ROUTER_PROVIDERS) {
    const raw = (providers as Record<string, unknown>)[provider];
    if (typeof raw !== "object" || raw == null || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const model = sanitizeRouterModelId(record.model);
    // Reasoning effort is only meaningful for Codex; drop it for other providers.
    const reasoningEffort = provider === "codex" && isRouterReasoningEffort(record.reasoningEffort) ? record.reasoningEffort : null;
    config.providers[provider] = { model, reasoningEffort };
  }
  return config;
}

export function parseRouterModelPreference(raw: string | null): RouterModelConfig {
  if (raw == null) return emptyRouterModelConfig();
  try {
    return parseRouterModelConfig(JSON.parse(raw));
  } catch {
    return emptyRouterModelConfig();
  }
}

/** Whether a model config carries any non-default selection. */
export function routerModelConfigHasSelection(config: RouterModelConfig): boolean {
  return ROUTED_ROUTER_PROVIDERS.some((provider) => {
    const entry = config.providers[provider];
    return entry.model != null || entry.reasoningEffort != null;
  });
}

/**
 * Return a new config with one provider's selection patched. An omitted field
 * is left unchanged; `model: null` clears the model; a model string is
 * sanitized (invalid values clear it). Reasoning effort is Codex-only and is
 * forced to `null` for every other provider.
 */
export function setRouterProviderModel(
  config: RouterModelConfig,
  provider: RoutedRouterProviderId,
  patch: { model?: string | null; reasoningEffort?: RouterReasoningEffort | null }
): RouterModelConfig {
  const current = config.providers[provider];
  const model = patch.model === undefined ? current.model : sanitizeRouterModelId(patch.model);
  const reasoningEffort =
    provider === "codex"
      ? patch.reasoningEffort === undefined
        ? current.reasoningEffort
        : isRouterReasoningEffort(patch.reasoningEffort)
          ? patch.reasoningEffort
          : null
      : null;
  return { ...config, providers: { ...config.providers, [provider]: { model, reasoningEffort } } };
}

/** The model that would be used for a routed turn: the selection, or the built-in default. */
export function effectiveRouterModel(config: RouterModelConfig, provider: RoutedRouterProviderId): string | null {
  return config.providers[provider].model ?? DEFAULT_ROUTED_MODEL[provider];
}

export async function loadRouterModel(persistence: RouterProviderPersistence): Promise<RouterModelConfig> {
  return parseRouterModelPreference(await persistence.read(ROUTER_MODEL_PERSISTENCE_KEY));
}

export async function saveRouterModel(persistence: RouterProviderPersistence, config: RouterModelConfig): Promise<void> {
  await persistence.write(ROUTER_MODEL_PERSISTENCE_KEY, JSON.stringify(config));
}
