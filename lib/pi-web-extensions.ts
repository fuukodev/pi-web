import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

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

/** Add Pi's built-in provider extensions while preserving caller extensions. */
export function withPiWebBuiltInExtensions<T extends object>(
  options: T,
): Omit<T, "extensionFactories"> & { extensionFactories: InlineExtension[] } {
  const configured = options as T & { extensionFactories?: InlineExtension[] };
  return {
    ...options,
    extensionFactories: [LLAMA_EXTENSION, ...(configured.extensionFactories ?? [])],
  };
}
