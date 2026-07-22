import type { SobaConfig } from "../../application/config/types";
import type { ModelDefinition, ProviderDefinition } from "../../application/providers/types";
import type { RuntimeSessionConfigOption } from "../../application/types";
import { OpenResponsesClientProxy } from "../../infrastructure/llm/providers/client-proxy";
import {
  discoverModels,
  getCachedModels,
  resolveMetadataProfile,
  supportsTextGeneration,
  toModelDefinitions,
} from "../../infrastructure/llm/providers/discovery";
import { ProviderRegistry } from "../../infrastructure/llm/providers/registry";
import {
  formatReasoningSelection,
  type ReasoningCapabilities,
  reasoningSelectionToConfigValue,
} from "../../kernel/model/reasoning";

export interface ProviderStackInput {
  config: SobaConfig;
  modelExplicitlyPassed: boolean;
  baseUrlOverride?: string;
  baseUrlExplicitlyPassed?: boolean;
  apiKeyExplicitlyPassed?: boolean;
  providerRegistryConfigPath?: string;
}

export interface ProviderStack {
  providerRegistry: ProviderRegistry;
  client: OpenResponsesClientProxy;
}

export async function createProviderStack(input: ProviderStackInput): Promise<ProviderStack> {
  const persistedRegistry = input.config.registry ?? await ProviderRegistry.loadFromFile(input.providerRegistryConfigPath);
  const providerRegistry = new ProviderRegistry(persistedRegistry ?? undefined, {
    configPath: input.providerRegistryConfigPath,
    clientDefaults: {
      maxCompletionTokens: input.config.maxCompletionTokens,
      temperature: input.config.temperature,
      reasoning: input.config.reasoning,
    },
  });
  const hasRegistry = Boolean(persistedRegistry);
  let cliProviderId: string | undefined;
  if (input.modelExplicitlyPassed || (!hasRegistry && input.config.model)) {
    const providers = providerRegistry.getAllProviders();
    const qualifiedProvider = providers.find((provider) => input.config.model.startsWith(`${provider.id}/`));
    if (qualifiedProvider) {
      const normalizedModel = input.config.model.slice(qualifiedProvider.id.length + 1);
      if (normalizedModel && providerRegistry.getModel(qualifiedProvider.id, normalizedModel)) {
        cliProviderId = qualifiedProvider.id;
        input.config.model = normalizedModel;
      }
    } else {
      const activeProviderId = providerRegistry.getActiveProvider().id;
      if (providerRegistry.getModel(activeProviderId, input.config.model)) {
        cliProviderId = activeProviderId;
      } else {
        cliProviderId = providers.find((provider) =>
          providerRegistry.getModelsFor(provider.id).some((model) => model.id === input.config.model)
        )?.id;
      }
    }
  }
  if (!cliProviderId && (!hasRegistry || input.baseUrlExplicitlyPassed)) {
    cliProviderId = providerRegistry.getAllProviders().find((provider) => provider.baseUrl === input.config.baseUrl)?.id;
  }
  if (cliProviderId) {
    providerRegistry.setActive(cliProviderId, input.config.model);
  }
  if (input.config.apiKey && (!hasRegistry || input.apiKeyExplicitlyPassed)) {
    providerRegistry.setApiKey(providerRegistry.getActiveProvider().id, input.config.apiKey);
  }
  await selectFallbackProviderWithCredentials(providerRegistry);
  await selectTextModelForActiveProvider(providerRegistry);

  const client = new OpenResponsesClientProxy(providerRegistry);
  const explicitBaseUrlOverride = input.baseUrlOverride ?? (input.baseUrlExplicitlyPassed ? input.config.baseUrl : undefined);
  if (explicitBaseUrlOverride) {
    providerRegistry.setBaseUrl(client.getActiveProviderId(), explicitBaseUrlOverride);
  }

  return { providerRegistry, client };
}

export async function buildProviderConfigOptions(providerRegistry: ProviderRegistry): Promise<RuntimeSessionConfigOption[]> {
  const activeProvider = providerRegistry.getActiveProvider();
  await refreshModelsForProvider(providerRegistry, activeProvider);
  const activeModel = providerRegistry.getActiveModel();
  const providerOptions = providerRegistry.getAllProviders().map((provider) => ({
    value: provider.id,
    name: provider.name,
    description: providerHasCredentials(providerRegistry, provider)
      ? provider.baseUrl
      : `${provider.baseUrl} (missing ${provider.apiKeyEnv ?? "API key"})`,
  }));

  const models = providerRegistry.getModelsFor(activeProvider.id);
  const modelOptions = (models.length > 0 ? models : [activeModel]).map((model) => ({
    value: model.id,
    name: model.name,
    description: `${model.contextWindow.toLocaleString()} ctx${model.limits?.contextWindow.source === "fallback" ? " (assumed)" : ""}, ${model.maxOutput.toLocaleString()} max output`,
  }));

  const reasoningOption = buildReasoningConfigOption(
    providerRegistry.getActiveClientConfig(),
  );

  return [
    {
      id: "provider",
      name: "Provider",
      description: "Model provider used for new turns.",
      category: "model",
      type: "select",
      currentValue: activeProvider.id,
      options: providerOptions,
    },
    {
      id: "model",
      name: "Model",
      description: "Model used for new turns.",
      category: "model",
      type: "select",
      currentValue: activeModel.id,
      options: modelOptions,
    },
    reasoningOption,
  ];
}

function buildReasoningConfigOption(
  config: ReturnType<ProviderRegistry["getActiveClientConfig"]>,
): RuntimeSessionConfigOption {
  const requested = config.reasoning ?? { mode: "provider_default" as const };
  const effective = config.reasoningEffective ?? { mode: "provider_default" as const };
  const currentValue = reasoningSelectionToConfigValue(requested);
  const options = reasoningSelectOptions(config.modelReasoning);
  if (!options.some((option) => option.value === currentValue)) {
    options.push({
      value: currentValue,
      name: `${formatReasoningSelection(requested)} (unsupported)`,
      description: "Provider default is effective for the active model.",
    });
  }
  const fallback = config.reasoningFallbackReason
    ? ` Requested ${formatReasoningSelection(requested)}; effective ${formatReasoningSelection(effective)}. ${config.reasoningFallbackReason}`
    : ` Effective: ${formatReasoningSelection(effective)}.`;
  return {
    id: "reasoning",
    name: "Reasoning",
    description: `Reasoning policy used for new turns.${fallback}`,
    category: "thought_level",
    type: "select",
    currentValue,
    options,
  };
}

function reasoningSelectOptions(
  capabilities?: ReasoningCapabilities,
): Array<{ value: string; name: string; description?: string }> {
  const options: Array<{ value: string; name: string; description?: string }> = [{
    value: "default",
    name: "Provider default",
    description: "Omit reasoning controls and let the provider choose.",
  }];
  if (!capabilities || capabilities.control === "none" || capabilities.control === "fixed") {
    return options;
  }
  if (capabilities.control === "effort") {
    for (const effort of capabilities.supportedEfforts ?? []) {
      if (capabilities.mandatory && effort === "none") continue;
      options.push({ value: effort, name: effort });
    }
  }
  if (capabilities.control === "toggle" || capabilities.supportsToggle) {
    options.push({ value: "on", name: "On" });
    if (!capabilities.mandatory) options.push({ value: "off", name: "Off" });
  }
  if (capabilities.control === "budget" || capabilities.supportsBudget) {
    for (const budget of reasoningBudgetPresets(capabilities)) {
      options.push({ value: `budget:${budget}`, name: `${budget.toLocaleString()} tokens` });
    }
  }
  return options;
}

function reasoningBudgetPresets(capabilities: ReasoningCapabilities): number[] {
  const min = capabilities.minBudgetTokens ?? 1;
  const max = capabilities.maxBudgetTokens ?? 32_768;
  const candidates = [min, 1_024, 4_096, 8_192, 16_384, max];
  return [...new Set(candidates.filter((value) => value >= min && value <= max))]
    .sort((a, b) => a - b);
}

export function providerHasCredentials(providerRegistry: ProviderRegistry, provider: ProviderDefinition): boolean {
  return !provider.apiKeyEnv || Boolean(providerRegistry.resolveApiKey(provider.id));
}

async function selectFallbackProviderWithCredentials(providerRegistry: ProviderRegistry): Promise<void> {
  const activeProvider = providerRegistry.getActiveProvider();
  if (providerHasCredentials(providerRegistry, activeProvider)) return;

  const fallback = await findFallbackProviderSelection(providerRegistry, activeProvider.id);
  if (fallback) {
    providerRegistry.setActive(fallback.providerId, fallback.modelId);
  }
}

async function selectTextModelForActiveProvider(providerRegistry: ProviderRegistry): Promise<void> {
  const activeProvider = providerRegistry.getActiveProvider();
  await refreshModelsForProvider(providerRegistry, activeProvider);
  const activeModel = providerRegistry.getActiveModel();
  if (activeModel.id) {
    const discovery = getCachedModels(
      activeProvider,
      providerRegistry.resolveApiKey(activeProvider.id),
    );
    const discoveredActive = discovery?.ok
      ? discovery.models.find((model) => model.id === activeModel.id)
      : undefined;
    if (!discoveredActive || supportsTextGeneration(discoveredActive)) return;
    const suggested = discovery?.ok
      ? providerRegistry
        .getModelsFor(activeProvider.id)
        .find((model) => model.id === discovery.suggestedDefault)
      : undefined;
    if (suggested) {
      providerRegistry.setActive(activeProvider.id, suggested.id);
      return;
    }
  }
  const model = await usableModelForProvider(providerRegistry, activeProvider);
  if (model && model.id !== activeModel.id) {
    providerRegistry.setActive(activeProvider.id, model.id);
  }
}

async function findFallbackProviderSelection(
  providerRegistry: ProviderRegistry,
  activeProviderId: string,
): Promise<{ providerId: string; modelId: string } | null> {
  for (const providerId of fallbackProviderIds(providerRegistry, activeProviderId)) {
    const provider = providerRegistry.getProvider(providerId);
    if (!provider || !providerHasCredentials(providerRegistry, provider)) continue;
    const model = await usableModelForProvider(providerRegistry, provider);
    if (model) return { providerId, modelId: model.id };
  }
  return null;
}

function fallbackProviderIds(providerRegistry: ProviderRegistry, activeProviderId: string): string[] {
  const savedProviderIds = Object.entries(providerRegistry.snapshotState().providers)
    .filter(([providerId, secret]) => providerId !== activeProviderId && Boolean(secret.apiKey))
    .map(([providerId]) => providerId);
  const remainingProviderIds = providerRegistry
    .getAllProviders()
    .map((provider) => provider.id)
    .filter((providerId) => providerId !== activeProviderId && !savedProviderIds.includes(providerId));
  return [...savedProviderIds, ...remainingProviderIds];
}

export async function usableModelForProvider(providerRegistry: ProviderRegistry, provider: ProviderDefinition): Promise<ModelDefinition | null> {
  await refreshModelsForProvider(providerRegistry, provider);
  const existingModels = providerRegistry.getModelsFor(provider.id);
  const existingModel =
    existingModels.find((model) => model.id === provider.defaultModel) ?? existingModels[0];
  if (existingModel) return existingModel;

  const discovery = await discoverModels(provider, providerRegistry.resolveApiKey(provider.id), { timeoutMs: 4_000 });
  if (!discovery.ok) return null;
  const discoveredModels = toModelDefinitions(discovery, provider);
  return discoveredModels.find((model) => model.id === discovery.suggestedDefault) ?? discoveredModels[0] ?? null;
}

async function refreshModelsForProvider(providerRegistry: ProviderRegistry, provider: ProviderDefinition): Promise<void> {
  if (resolveMetadataProfile(provider) === "none") return;
  if (!providerHasCredentials(providerRegistry, provider)) return;
  const discovery = await discoverModels(provider, providerRegistry.resolveApiKey(provider.id), { timeoutMs: 4_000 });
  if (discovery.ok) {
    for (const model of discovery.models) providerRegistry.invalidateClient(provider.id, model.id);
  }
}
