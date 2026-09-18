import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const LLAMA_PROVIDER_ID = "llama.cpp";
const LLAMA_REFRESH_TIMEOUT_MS = 15_000;

/**
 * Populate a newly authenticated llama.cpp provider when its persistent model
 * catalog is empty. `/login llama.cpp` validates the server and stores the
 * credential, but the CLI's `/llama` command is normally what refreshes the
 * catalog. Pi Web has no terminal `/llama` step, so do one bounded refresh on
 * demand while keeping cached startups offline and fast.
 */
export async function refreshPiWebLlamaModels(
  modelRuntime: Pick<ModelRuntime, "getProvider" | "hasConfiguredAuth" | "refresh">,
): Promise<void> {
  const provider = modelRuntime.getProvider(LLAMA_PROVIDER_ID);
  if (!provider || provider.getModels().length > 0 || !modelRuntime.hasConfiguredAuth(LLAMA_PROVIDER_ID)) {
    return;
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
}
