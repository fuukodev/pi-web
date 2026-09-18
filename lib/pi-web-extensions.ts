import type { Api, Provider } from "@earendil-works/pi-ai";
import type {
  ExtensionFactory,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";

const LLAMA_EXTENSION: InlineExtension = {
  name: "llama.cpp",
  hidden: true,
  factory: async (pi) => {
    // The SDK exposes the extension factory to the CLI but not through its
    // public package exports. Resolve the shipped dist file at runtime so
    // pi-web uses the exact same llama.cpp implementation as `pi`.
    const packageEntry = await import.meta.resolve("@earendil-works/pi-coding-agent");
    const module = await import(new URL("./extensions/llama/index.js", packageEntry).href) as {
      default: ExtensionFactory;
    };
    await module.default(pi);
  },
};

const LLAMA_PROVIDER_EXTENSION: InlineExtension = {
  name: "llama.cpp",
  hidden: true,
  factory: async (pi) => {
    // Chat-only and resource-isolated subagent sessions need the provider for
    // model selection, but must not load the interactive `/llama` command.
    const packageEntry = await import.meta.resolve("@earendil-works/pi-coding-agent");
    const module = await import(new URL("./extensions/llama/provider.js", packageEntry).href) as {
      createLlamaProvider: () => { provider: Provider<Api> };
    };
    pi.registerProvider(module.createLlamaProvider().provider);
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

/** Add Pi's built-in provider and interactive commands. */
export function withPiWebBuiltInExtensions<T extends object>(options: T): ResourceLoaderOptions<T> {
  return withPiWebLlamaExtensions(options);
}

/** Add only Pi's built-in provider, without interactive extension commands. */
export function withPiWebLlamaProvider<T extends object>(options: T): ResourceLoaderOptions<T> {
  return withPiWebLlamaExtensions(options, { includeCommands: false });
}
