import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import {
  readStoredProviderCredential,
  removeStoredCredentialIfType,
  storeProviderCredential,
} from "@/lib/provider-credential-store";
import { registerPiWebLlamaProvider } from "@/lib/pi-web-extensions";
import { invalidatePiWebLlamaRefresh } from "@/lib/pi-web-llama";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

const LLAMA_LOGIN_TIMEOUT_MS = 15_000;

function isValidLlamaServerUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

// POST /api/auth/api-key/[provider]  body: { apiKey?: string, serverUrl?: string }
export async function POST(req: Request, { params }: Params) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const { provider } = await params;
  try {
    const body = await req.json() as { apiKey?: unknown; baseUrl?: unknown; serverUrl?: unknown };
    const hasApiKey = Object.hasOwn(body, "apiKey");
    if (hasApiKey && typeof body.apiKey !== "string") {
      return NextResponse.json({ error: "apiKey must be a string" }, { status: 400 });
    }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const serverUrl = typeof body.serverUrl === "string"
      ? body.serverUrl.trim()
      : typeof body.baseUrl === "string"
        ? body.baseUrl.trim()
        : "";
    const isLlama = provider === "llama.cpp";
    if ((!isLlama && !apiKey) || (isLlama && !serverUrl)) {
      return NextResponse.json(
        { error: isLlama ? "serverUrl is required" : "apiKey is required" },
        { status: 400 },
      );
    }
    if (isLlama && !isValidLlamaServerUrl(serverUrl)) {
      return NextResponse.json(
        { error: "serverUrl must be an http(s) URL without credentials or query parameters" },
        { status: 400 },
      );
    }
    const modelRuntime = await ModelRuntime.create();
    if (isLlama) await registerPiWebLlamaProvider(modelRuntime);
    const storedCredential = isLlama && !hasApiKey
      ? await readStoredProviderCredential(provider)
      : undefined;
    const retainedApiKey = storedCredential?.type === "api_key" && typeof storedCredential.key === "string"
      ? storedCredential.key
      : "";
    const apiKeyAuth = modelRuntime.getProvider(provider)?.auth.apiKey;
    if (!apiKeyAuth?.login) {
      throw new Error(`${provider} does not support API key login`);
    }
    let keySubmitted = false;
    let serverUrlSubmitted = false;
    const loginSignal = isLlama
      ? AbortSignal.any([req.signal, AbortSignal.timeout(LLAMA_LOGIN_TIMEOUT_MS)])
      : req.signal;
    const credential = await apiKeyAuth.login({
      signal: loginSignal,
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const keyOption = prompt.options.find((option) => option.id === "api-key" || option.id === "bearer-token");
          if (keyOption) return keyOption.id;
          throw new Error(`${provider} requires interactive authentication setup`);
        }
        if (isLlama && !serverUrlSubmitted && prompt.type === "text") {
          serverUrlSubmitted = true;
          return serverUrl;
        }
        if (!keySubmitted && prompt.type === "secret") {
          keySubmitted = true;
          // The UI treats llama.cpp's key as optional. Preserve a stored key
          // when only the server URL is being replaced, without copying keys
          // from ambient environment variables into auth.json.
          return apiKey || retainedApiKey;
        }
        throw new Error(`${provider} requires additional authentication settings`);
      },
    });
    // ModelRuntime.login() persists the credential and then performs an
    // unbounded network catalog refresh. Store the returned credential
    // directly so a slow catalog cannot leave the save request hanging.
    // Keep the retained key only for validation; the final locked write must
    // merge with whatever credential is current after the network request.
    const credentialToStore = isLlama && !hasApiKey && credential.type === "api_key"
      ? { ...credential, key: undefined }
      : credential;
    await storeProviderCredential(provider, credentialToStore, undefined, {
      preserveExistingApiKey: isLlama && !hasApiKey,
    });
    if (isLlama) invalidatePiWebLlamaRefresh();
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const { provider } = await params;
  try {
    const removal = await removeStoredCredentialIfType(provider, "api_key");
    if (removal.status === "type_mismatch") {
      return NextResponse.json(
        { error: `${provider} is authenticated with OAuth, not an API key` },
        { status: 409 },
      );
    }
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
