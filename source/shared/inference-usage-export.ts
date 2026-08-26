import {
  DEFAULT_ROUTED_PROVIDER_MODEL,
  SAND_INFERENCE_PROVIDERS,
  isSandRoutedInferenceProvider,
  type SandInferenceProvider,
  type SandInferenceRouterUsage,
  type SandRoutedModelConfig,
} from "./inference-router.js";

// A flat, per-provider view of the recorded routed usage, annotated with the
// model that provider is currently configured to route through. Cursor has no
// routed model, so its `model` is null.
export interface RoutedUsageRow {
  readonly provider: SandInferenceProvider;
  readonly model: string | null;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly lastUsedAt: string | null;
}

function selectedModel(provider: SandInferenceProvider, models?: SandRoutedModelConfig | null): string | null {
  if (!isSandRoutedInferenceProvider(provider)) return null;
  return models?.providers[provider].model ?? DEFAULT_ROUTED_PROVIDER_MODEL[provider];
}

export function routedUsageRows(usage: SandInferenceRouterUsage, models?: SandRoutedModelConfig | null): RoutedUsageRow[] {
  return SAND_INFERENCE_PROVIDERS.map((provider) => {
    const entry = usage.providers[provider];
    return {
      provider,
      model: selectedModel(provider, models),
      requests: entry.requests,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      totalTokens: entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens,
      lastUsedAt: entry.lastUsedAt,
    };
  });
}

export function formatRoutedUsageJson(usage: SandInferenceRouterUsage, models?: SandRoutedModelConfig | null): string {
  return `${JSON.stringify({ schemaVersion: 1, providers: routedUsageRows(usage, models) }, null, 2)}\n`;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatRoutedUsageCsv(usage: SandInferenceRouterUsage, models?: SandRoutedModelConfig | null): string {
  const header = ["provider", "model", "requests", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "lastUsedAt"];
  const lines = [header.join(",")];
  for (const row of routedUsageRows(usage, models)) {
    lines.push([
      row.provider,
      row.model ?? "",
      String(row.requests),
      String(row.inputTokens),
      String(row.outputTokens),
      String(row.cacheReadTokens),
      String(row.cacheWriteTokens),
      String(row.totalTokens),
      row.lastUsedAt ?? "",
    ].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
