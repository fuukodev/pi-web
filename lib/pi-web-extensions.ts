import { findPackageJSON } from "node:module";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, Provider } from "@earendil-works/pi-ai";
import type {
  ExtensionFactory,
  InlineExtension,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

type LlamaProviderModule = {
  createLlamaProvider: () => { provider: Provider<Api> };
};

const piPackageJson = findPackageJSON(
  "@earendil-works/pi-coding-agent",
  pathToFileURL(resolvePath(process.cwd(), "package.json")),
);
if (!piPackageJson) throw new Error("Unable to resolve @earendil-works/pi-coding-agent");
const PI_PACKAGE_JSON_URL = pathToFileURL(piPackageJson);

function resolvePiPackageFile(relativePath: string): string {
  return new URL(relativePath, PI_PACKAGE_JSON_URL).href;
}

async function loadLlamaProvider(): Promise<Provider<Api>> {
  const llamaModule = await import(resolvePiPackageFile("./dist/extensions/llama/provider.js")) as LlamaProviderModule;
  return llamaModule.createLlamaProvider().provider;
}

const LLAMA_EXTENSION: InlineExtension = {
  name: "llama.cpp",
  hidden: true,
  factory: async (pi) => {
    // The SDK exposes the extension factory to the CLI but not through its
    // public package exports. Resolve the shipped dist file at runtime so
    // pi-web uses the exact same llama.cpp implementation as `pi`.
    const llamaModule = await import(resolvePiPackageFile("./dist/extensions/llama/index.js")) as {
      default: ExtensionFactory;
    };
    await llamaModule.default(pi);
  },
};

const LLAMA_PROVIDER_EXTENSION: InlineExtension = {
  name: "llama.cpp",
  hidden: true,
  factory: async (pi) => {
    // Chat-only and resource-isolated subagent sessions need the provider for
    // model selection, but must not load the interactive `/llama` command.
    pi.registerProvider(await loadLlamaProvider());
  },
};

type ResourceLoaderOptions<T extends object> = Omit<T, "extensionFactories"> & {
  extensionFactories: InlineExtension[];
};

function withLlamaExtension<T extends object>(
  options: T,
  extension: InlineExtension,
): ResourceLoaderOptions<T> {
  const configured = options as T & { extensionFactories?: InlineExtension[] };
  return {
    ...options,
    extensionFactories: [extension, ...(configured.extensionFactories ?? [])],
  };
}

/** Add Pi's built-in llama provider, optionally with interactive commands. */
export function withPiWebLlamaExtensions<T extends object>(
  options: T,
  { includeCommands = true }: { includeCommands?: boolean } = {},
): ResourceLoaderOptions<T> {
  return withLlamaExtension(options, includeCommands ? LLAMA_EXTENSION : LLAMA_PROVIDER_EXTENSION);
}

/** Register the built-in provider on runtimes that do not use a resource loader. */
export async function registerPiWebLlamaProvider(
  modelRuntime: Pick<ModelRuntime, "registerNativeProvider">,
): Promise<void> {
  modelRuntime.registerNativeProvider(await loadLlamaProvider());
}

/** Add Pi's built-in provider and interactive commands. */
export function withPiWebBuiltInExtensions<T extends object>(options: T): ResourceLoaderOptions<T> {
  return withPiWebLlamaExtensions(options);
}

/** Add only Pi's built-in provider, without interactive extension commands. */
export function withPiWebLlamaProvider<T extends object>(options: T): ResourceLoaderOptions<T> {
  return withPiWebLlamaExtensions(options, { includeCommands: false });
}
