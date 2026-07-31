const connectHeaders = "authorization,content-type,connect-protocol-version";
const allowedMethods = "POST,OPTIONS";

/**
 * Returns the narrow CORS response headers for the local Chat browser gateway.
 *
 * @param origin Supplies the incoming browser origin.
 * @param method Supplies the incoming HTTP method.
 * @param webOrigin Supplies the only browser origin permitted by this local server.
 * @returns Returns headers for the allowed origin, or an empty object for every other origin.
 */
export const LocalChatCors: Readonly<{
  headers(
    origin: string | undefined,
    method: string,
    webOrigin?: string,
  ): Readonly<Record<string, string>>;
}> = Object.freeze({
  headers(
    origin: string | undefined,
    method: string,
    webOrigin = "http://127.0.0.1:5173",
  ): Readonly<Record<string, string>> {
    if (origin !== webOrigin) return {};
    return Object.freeze({
      "access-control-allow-origin": webOrigin,
      ...(method === "OPTIONS"
        ? {
            "access-control-allow-methods": allowedMethods,
            "access-control-allow-headers": connectHeaders,
            "access-control-max-age": "600",
          }
        : {}),
    });
  },
});
