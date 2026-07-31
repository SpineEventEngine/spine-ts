/**
 * Reads the local MessageBoard gateway URL from Vite configuration.
 *
 * @param environment Supplies Vite environment values.
 * @returns Returns the configured loopback gateway URL.
 */
export const LocalBoardGateway: Readonly<{
  url(environment: Readonly<Record<string, string | undefined>>): string;
}> = Object.freeze({
  url(environment: Readonly<Record<string, string | undefined>>): string {
    const value = environment.VITE_MESSAGE_BOARD_GATEWAY_URL ?? "http://127.0.0.1:8090";
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        "VITE_MESSAGE_BOARD_GATEWAY_URL must be a loopback HTTP URL with an explicit port.",
      );
    }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port === "")
      throw new Error(
        "VITE_MESSAGE_BOARD_GATEWAY_URL must be a loopback HTTP URL with an explicit port.",
      );
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error("VITE_MESSAGE_BOARD_GATEWAY_URL must use a port from 1 through 65535.");
    return url.toString().replace(/\/$/u, "");
  },
});
