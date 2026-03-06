/**
 * Singleton lazy loader for the libdivecomputer WASM module.
 *
 * Loads the Emscripten-compiled WASM module from a configurable base URL.
 * Default: '/libdivecomputer' (backward compatible with Vite public dir).
 */

/** Emscripten module interface — only the bits we use */
export interface LibDCModule {
  _libdc_parse_dive(
    data: number,
    size: number,
    family: number,
    model: number,
  ): number;
  _libdc_list_descriptors(): number;
  _libdc_free_result(ptr: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  UTF8ToString(ptr: number): string;
}

type EmscriptenFactory = (config: {
  locateFile: (path: string) => string;
}) => Promise<LibDCModule>;

/** Configuration options for the WASM loader */
export interface LibDCLoaderOptions {
  /** Base URL where libdc.js and libdc.wasm are served. Default: '/libdivecomputer' */
  baseUrl?: string;
}

let defaultBaseUrl = '/libdivecomputer';
let modulePromise: Promise<LibDCModule> | null = null;

/**
 * Configure the default base URL for WASM assets.
 * Call before first loadLibDC() invocation.
 */
export function configureLibDC(options: LibDCLoaderOptions): void {
  if (options.baseUrl !== undefined) {
    // Strip trailing slash
    defaultBaseUrl = options.baseUrl.replace(/\/+$/, '');
    // Reset cached module if base URL changed
    modulePromise = null;
  }
}

/**
 * Load the Emscripten JS glue code via a script tag.
 * Emscripten's MODULARIZE output assigns the factory to a global name.
 */
function loadEmscriptenFactory(baseUrl: string): Promise<EmscriptenFactory> {
  return new Promise((resolve, reject) => {
    // Check if already loaded (e.g. from a previous call that loaded the script)
    const existing = (globalThis as Record<string, unknown>)['createLibDC'] as
      | EmscriptenFactory
      | undefined;
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = `${baseUrl}/libdc.js`;
    script.async = true;
    script.onload = () => {
      const factory = (globalThis as Record<string, unknown>)[
        'createLibDC'
      ] as EmscriptenFactory | undefined;
      if (factory) {
        resolve(factory);
      } else {
        reject(new Error('createLibDC not found after loading libdc.js'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load libdc.js'));
    document.head.appendChild(script);
  });
}

/**
 * Load the libdivecomputer WASM module (cached singleton).
 * Returns the Emscripten module instance.
 */
export async function loadLibDC(options?: LibDCLoaderOptions): Promise<LibDCModule> {
  const baseUrl = options?.baseUrl?.replace(/\/+$/, '') ?? defaultBaseUrl;

  // Only use cache if using the default base URL
  if (baseUrl === defaultBaseUrl && modulePromise) return modulePromise;

  const promise = (async () => {
    const createLibDC = await loadEmscriptenFactory(baseUrl);

    const module: LibDCModule = await createLibDC({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return `${baseUrl}/libdc.wasm`;
        }
        return path;
      },
    });

    // Validate the module initialized properly (WASM instantiation may silently fail)
    if (!module.HEAPU8 || !module._libdc_parse_dive) {
      throw new Error('WASM module failed to initialize — HEAPU8 or exports missing');
    }

    return module;
  })();

  if (baseUrl === defaultBaseUrl) {
    modulePromise = promise;
    // If loading fails, reset so we can retry
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }

  return promise;
}

/**
 * Check if the WASM module is available (built and served).
 * Does a quick HEAD request to avoid loading the full module.
 */
export async function isLibDCAvailable(options?: LibDCLoaderOptions): Promise<boolean> {
  const baseUrl = options?.baseUrl?.replace(/\/+$/, '') ?? defaultBaseUrl;
  try {
    const resp = await fetch(`${baseUrl}/libdc.wasm`, { method: 'HEAD' });
    return resp.ok;
  } catch {
    return false;
  }
}
