import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  type GeneratedHandlerRegistry,
  HandlerRegistryIngestor,
} from "./generated-handler-registry.js";
import { HandlerMetadataRegistry } from "./handler-metadata.js";

const defaultExportName = "generatedHandlerRegistry";
const generatedRegistryFile = "generated/handler/generated-handler-registry.js";
const moduleSchemeRe = /^[A-Za-z][A-Za-z\d+.-]*:/;
const registryVersion = 1;

/** Stable error code for generated registry discovery failures. */
export type RegistryDiscoveryErrorCode =
  | "MODULE_IMPORT_FAILED"
  | "MISSING_REGISTRY_EXPORT"
  | "INVALID_REGISTRY_MODULE"
  | "REGISTRY_INGESTION_FAILED"
  | "UNSUPPORTED_MODULE_SCHEME"
  | "INVALID_MODULE_REF"
  | "DUPLICATE_REGISTRY_MODULE";

/** Options for loading one or more generated registry modules. */
export interface GeneratedRegistryDiscoveryOptions {
  /** Explicit filesystem paths or file: URLs to load. */
  readonly modules: readonly (string | URL)[];
  /** Export name expected from each generated module. */
  readonly exportName?: string;
  /** Optional retry token used to bypass Node's dynamic import cache for canonical modules. */
  readonly cacheBust?: string;
}

/** Error thrown when generated registry discovery or loading fails. */
export class GeneratedRegistryDiscoveryError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: RegistryDiscoveryErrorCode;
  /** Normalized imported module identifier. */
  readonly moduleId: string;
  /** Optional underlying import or ingestion error. */
  override readonly cause: unknown;

  constructor(
    code: RegistryDiscoveryErrorCode,
    message: string,
    moduleId: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "GeneratedRegistryDiscoveryError";
    this.code = code;
    this.moduleId = moduleId;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Framework-owned runtime loader for generated handler registry modules. */
export class GeneratedRegistryDiscovery {
  readonly #ingestor: HandlerRegistryIngestor;

  constructor(ingestor: HandlerRegistryIngestor = new HandlerRegistryIngestor()) {
    this.#ingestor = ingestor;
  }

  /** Build the conventional generated registry module path for one package or app root. */
  static conventionalModulePath(root: string): string {
    return resolve(root, generatedRegistryFile);
  }

  /** Build the conventional generated registry module URL for one package or app root. */
  static conventionalModuleUrl(root: string): URL {
    return pathToFileURL(GeneratedRegistryDiscovery.conventionalModulePath(root));
  }

  /** Load generated handler registries from explicit filesystem paths or file: URLs. */
  async load(options: GeneratedRegistryDiscoveryOptions): Promise<readonly unknown[]> {
    const loaded = await this.loadModules(options);

    return Object.freeze(loaded.map((entry) => entry.registry));
  }

  /**
   * Load generated handler registries and ingest them into a caller-owned metadata registry.
   *
   * Registration stages all new metadata before mutating the caller-owned registry.
   */
  async register(
    options: GeneratedRegistryDiscoveryOptions,
    registry?: HandlerMetadataRegistry,
  ): Promise<HandlerMetadataRegistry> {
    const loaded = await this.loadModules(options);
    const target = registry ?? new HandlerMetadataRegistry();
    const existing = target.listEntityHandlers();
    const staged = new HandlerMetadataRegistry(existing);

    for (const entry of loaded) {
      try {
        this.#ingestor.register(entry.registry, staged);
      } catch (error) {
        throw new GeneratedRegistryDiscoveryError(
          "REGISTRY_INGESTION_FAILED",
          `Generated handler registry module "${entry.moduleId}" could not be ingested.`,
          entry.moduleId,
          error,
        );
      }
    }

    if (registry === undefined) {
      return staged;
    }

    for (const metadata of staged.listEntityHandlers().slice(existing.length)) {
      registry.register(metadata);
    }

    return registry;
  }

  private async loadModules(
    options: GeneratedRegistryDiscoveryOptions,
  ): Promise<readonly LoadedGeneratedRegistry[]> {
    const exportName = options.exportName ?? defaultExportName;
    const moduleRefs = [...options.modules];
    const moduleIds = moduleRefs.map((moduleRef) => normalizeModuleId(moduleRef));
    const loaded: LoadedGeneratedRegistry[] = [];

    assertNoDuplicateModules(moduleIds);

    for (const moduleId of moduleIds) {
      const exports = await importGeneratedRegistryModule(cacheableModuleId(moduleId, options));

      loaded.push({
        moduleId,
        registry: readGeneratedRegistryExport(exports, moduleId, exportName),
      });
    }

    return Object.freeze(loaded);
  }
}

interface LoadedGeneratedRegistry {
  readonly moduleId: string;
  readonly registry: GeneratedHandlerRegistry;
}

async function importGeneratedRegistryModule(moduleId: string): Promise<unknown> {
  try {
    return await import(moduleId);
  } catch (error) {
    throw new GeneratedRegistryDiscoveryError(
      "MODULE_IMPORT_FAILED",
      `Could not import generated handler registry module "${moduleId}".`,
      moduleId,
      error,
    );
  }
}

function cacheableModuleId(moduleId: string, options: GeneratedRegistryDiscoveryOptions): string {
  if (options.cacheBust === undefined || options.cacheBust.length === 0) {
    return moduleId;
  }

  const moduleUrl = new URL(moduleId);

  moduleUrl.searchParams.set("spine-registry-cache", options.cacheBust);
  return moduleUrl.href;
}

function readGeneratedRegistryExport(
  exports: unknown,
  moduleId: string,
  exportName: string,
): GeneratedHandlerRegistry {
  const value = readModuleExport(exports, exportName);

  if (value === undefined) {
    throw new GeneratedRegistryDiscoveryError(
      "MISSING_REGISTRY_EXPORT",
      `Generated handler registry module "${moduleId}" does not export "${exportName}".`,
      moduleId,
    );
  }

  if (isGeneratedHandlerRegistry(value)) {
    return value;
  }

  throw new GeneratedRegistryDiscoveryError(
    "INVALID_REGISTRY_MODULE",
    `Generated handler registry module "${moduleId}" exports invalid "${exportName}" metadata.`,
    moduleId,
  );
}

function readModuleExport(exports: unknown, exportName: string): unknown {
  if (exports === null || typeof exports !== "object") {
    return undefined;
  }

  return (exports as Record<string, unknown>)[exportName];
}

function isGeneratedHandlerRegistry(value: unknown): value is GeneratedHandlerRegistry {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const version = (value as { readonly version?: unknown }).version;
  const entities = (value as { readonly entities?: unknown }).entities;

  return version === registryVersion && Array.isArray(entities);
}

function normalizeModuleId(moduleRef: string | URL): string {
  if (moduleRef instanceof URL) {
    return normalizeModuleUrl(moduleRef);
  }

  if (isUrlLike(moduleRef)) {
    return normalizeModuleUrl(parseModuleUrl(moduleRef));
  }

  return pathToFileURL(resolve(moduleRef)).href;
}

function normalizeModuleUrl(moduleUrl: URL): string {
  if (moduleUrl.protocol !== "file:") {
    throw new GeneratedRegistryDiscoveryError(
      "UNSUPPORTED_MODULE_SCHEME",
      `Generated handler registry module "${moduleUrl.href}" must use the file: URL scheme.`,
      moduleUrl.href,
    );
  }

  if (moduleUrl.search.length > 0 || moduleUrl.hash.length > 0) {
    throw new GeneratedRegistryDiscoveryError(
      "INVALID_MODULE_REF",
      `Generated handler registry module "${moduleUrl.href}" must not include a query or hash.`,
      moduleUrl.href,
    );
  }

  try {
    return pathToFileURL(resolve(fileURLToPath(moduleUrl))).href;
  } catch (error) {
    throw new GeneratedRegistryDiscoveryError(
      "INVALID_MODULE_REF",
      `Generated handler registry module "${moduleUrl.href}" is not a valid file URL.`,
      moduleUrl.href,
      error,
    );
  }
}

function isUrlLike(moduleRef: string): boolean {
  return moduleSchemeRe.test(moduleRef) && !/^[A-Za-z]:[\\/]/.test(moduleRef);
}

function parseModuleUrl(moduleRef: string): URL {
  try {
    return new URL(moduleRef);
  } catch (error) {
    throw new GeneratedRegistryDiscoveryError(
      "INVALID_MODULE_REF",
      `Generated handler registry module "${moduleRef}" is not a valid URL.`,
      moduleRef,
      error,
    );
  }
}

function assertNoDuplicateModules(moduleIds: readonly string[]): void {
  const seen = new Set<string>();

  for (const moduleId of moduleIds) {
    if (seen.has(moduleId)) {
      throw new GeneratedRegistryDiscoveryError(
        "DUPLICATE_REGISTRY_MODULE",
        `Generated handler registry module "${moduleId}" was listed more than once.`,
        moduleId,
      );
    }

    seen.add(moduleId);
  }
}
