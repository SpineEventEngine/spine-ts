import { Time } from "../packages/core/src/time/index.ts";

/**
 * Represents a temporary public registry GET failure without implying absence.
 */
export class TemporaryRegistryError extends Error {}

/**
 * Reads one public registry resource with at most three bounded GET attempts.
 * The optional limit bounds all attempts and delays together.
 *
 * @param fetchResponse HTTP fetch function used for public registry reads.
 * @param url Exact public registry resource URL.
 * @param timeoutMs Maximum duration of one GET attempt in milliseconds.
 * @param limitMs Optional total read limit in milliseconds.
 * @returns Parsed JSON, or undefined for an explicit 404 response.
 */
export async function readRegistryGet(fetchResponse, url, { timeoutMs = 10_000, limitMs } = {}) {
  const deadline = limitMs === undefined ? Infinity : Time.currentTimeMillis() + limitMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Time.currentTimeMillis();
    if (remaining <= 0) throw new TemporaryRegistryError("Registry read deadline expired: " + url);
    const controller = new globalThis.AbortController();
    let timer;
    const timed = new Promise((_, reject) => {
      timer = globalThis.setTimeout(
        () => {
          reject(new TemporaryRegistryError("Registry read timed out: " + url));
          controller.abort();
        },
        Math.min(timeoutMs, remaining),
      );
    });
    try {
      const response = await Promise.race([
        fetchResponse(url, { signal: controller.signal }),
        timed,
      ]);
      if (response.status === 404) return undefined;
      if (response.status === 429 || (response.status >= 500 && response.status <= 599))
        throw new TemporaryRegistryError("Registry read failed: " + response.status);
      if (!response.ok) throw new Error("Registry read failed: " + response.status);
      return await Promise.race([response.json(), timed]);
    } catch (error) {
      const temporary = error instanceof TemporaryRegistryError || error instanceof TypeError;
      if (!temporary) throw error;
      const failure =
        error instanceof TemporaryRegistryError
          ? error
          : new TemporaryRegistryError("Registry transport failed: " + url, { cause: error });
      if (attempt === 2) throw failure;
      const delay = Math.min(50 * (attempt + 1), deadline - Time.currentTimeMillis());
      if (delay <= 0) throw failure;
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    } finally {
      globalThis.clearTimeout(timer);
      controller.abort();
    }
  }
}
