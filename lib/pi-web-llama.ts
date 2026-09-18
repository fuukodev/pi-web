import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const LLAMA_PROVIDER_ID = "llama.cpp";
const LLAMA_REFRESH_TIMEOUT_MS = 15_000;

function catalogMatchesServer(models: readonly Model<Api>[], baseUrl: string): boolean {
  return models.length > 0 && models.every((model) => model.baseUrl === baseUrl);
}

/** Remove a previous server's models without losing future refresh behavior. */
function clearStaleLlamaCatalog(
  modelRuntime: Pick<ModelRuntime, "registerNativeProvider">,
  provider: Provider<Api>,
): void {
  const originalRefresh = provider.refreshModels;
  let models: readonly Model<Api>[] = [];
  const emptyProvider: Provider<Api> = {
    ...provider,
    getModels: () => models,
    refreshModels: originalRefresh
      ? async (context) => {
          await originalRefresh({
            ...context,
            // Never restore the old server's persisted catalog into this replacement.
            stored: undefined,
            publish: async (publication) => context.publish({
              ...publication,
              update: () => {
                publication.update?.();
                models = [...provider.getModels()];
              },
            }),
          });
        }
      : undefined,
  };
  modelRuntime.registerNativeProvider(emptyProvider);
}

/**
 * Populate a newly authenticated llama.cpp provider when its persistent model
 * catalog is empty. `/login llama.cpp` validates the server and stores the
 * credential, but the CLI's `/llama` command is normally what refreshes the
 * catalog. Pi Web has no terminal `/llama` step, so do one bounded refresh on
 * demand while keeping cached startups offline and fast.
 */
export async function refreshPiWebLlamaModels(
  modelRuntime: Pick<ModelRuntime, "getProvider" | "hasConfiguredAuth" | "getAuth" | "refresh" | "registerNativeProvider">,
): Promise<void> {
  const provider = modelRuntime.getProvider(LLAMA_PROVIDER_ID);
  if (!provider || !modelRuntime.hasConfiguredAuth(LLAMA_PROVIDER_ID)) return;

  const models = provider.getModels();
  let configuredBaseUrl: string | undefined;
  if (models.length > 0) {
    try {
      configuredBaseUrl = (await modelRuntime.getAuth(LLAMA_PROVIDER_ID))?.auth.baseUrl;
      if (!configuredBaseUrl || catalogMatchesServer(models, configuredBaseUrl)) return;
    } catch {
      return;
    }
  }

  try {
    await modelRuntime.refresh({
      providers: [LLAMA_PROVIDER_ID],
      allowNetwork: true,
      signal: AbortSignal.timeout(LLAMA_REFRESH_TIMEOUT_MS),
    });
  } catch {
    // A disconnected local server should not hide the other providers from Pi Web.
  }

  if (configuredBaseUrl) {
    const refreshedProvider = modelRuntime.getProvider(LLAMA_PROVIDER_ID);
    if (refreshedProvider && !catalogMatchesServer(refreshedProvider.getModels(), configuredBaseUrl)) {
      clearStaleLlamaCatalog(modelRuntime, refreshedProvider);
    }
  }
}
