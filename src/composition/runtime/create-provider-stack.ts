import type { SobaConfig } from "../../application/config/types";
import type { ModelDefinition, ProviderDefinition } from "../../application/providers/types";
import type { RuntimeSessionConfigOption } from "../../application/types";
import { OpenResponsesClientProxy } from "../../infrastructure/llm/providers/client-proxy";
import { discoverModels, isLikelyChatModelId, toModelDefinitions } from "../../infrastructure/llm/providers/discovery";
import { ProviderRegistry } from "../../infrastructure/llm/providers/registry";

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
  const providerRegistry = new ProviderRegistry(persistedRegistry ?? undefined, { configPath: input.providerRegistryConfigPath });
  const hasRegistry = Boolean(persistedRegistry);
  let cliProviderId: string | undefined;
  if (input.modelExplicitlyPassed || (!hasRegistry && input.config.model)) {
    for (const provider of providerRegistry.getAllProviders()) {
      if (providerRegistry.getModel(provider.id, input.config.model)) {
        cliProviderId = provider.id;
        break;
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
  await selectChatModelForActiveProvider(providerRegistry);

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
    description: `${model.contextWindow.toLocaleString()} ctx, ${model.maxOutput.toLocaleString()} max output`,
  }));

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
  ];
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

async function selectChatModelForActiveProvider(providerRegistry: ProviderRegistry): Promise<void> {
  const activeProvider = providerRegistry.getActiveProvider();
  const activeModel = providerRegistry.getActiveModel();
  if (activeModel.id && isLikelyChatModelId(activeModel.id)) return;
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
  const chatModels = existingModels.filter((model) => isLikelyChatModelId(model.id));
  const candidateModels = chatModels.length > 0 ? chatModels : existingModels;
  const existingModel =
    candidateModels.find((model) => model.id === provider.defaultModel) ??
    candidateModels.find((model) => model.id.toLowerCase().includes("chat")) ??
    candidateModels.find((model) => model.id.toLowerCase().includes("code")) ??
    candidateModels[0];
  if (existingModel) return existingModel;

  const discovery = await discoverModels(provider, providerRegistry.resolveApiKey(provider.id), { timeoutMs: 4_000 });
  if (!discovery.ok) return null;
  const discoveredModels = toModelDefinitions(discovery, provider);
  const discoveredChatModels = discoveredModels.filter((model) => isLikelyChatModelId(model.id));
  const discoveredCandidates = discoveredChatModels.length > 0 ? discoveredChatModels : discoveredModels;
  return discoveredCandidates.find((model) => model.id === discovery.suggestedDefault) ?? discoveredCandidates[0] ?? null;
}

async function refreshModelsForProvider(providerRegistry: ProviderRegistry, provider: ProviderDefinition): Promise<void> {
  if (provider.models && provider.models.length > 0) return;
  if (!providerHasCredentials(providerRegistry, provider)) return;
  await discoverModels(provider, providerRegistry.resolveApiKey(provider.id), { timeoutMs: 4_000 });
}
