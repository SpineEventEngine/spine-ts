/**
 * Matches the two authored Proto filename forms reserved for domain rejections.
 *
 * @internal
 */
interface RejectionSourceMatcher {
  matches(sourceName: string): boolean;
}

export const RejectionSources: Readonly<RejectionSourceMatcher> = Object.freeze({
  matches(sourceName: string): boolean {
    const basename = sourceName.split("/").at(-1);
    return basename === "rejections.proto" || basename?.endsWith("_rejections.proto") === true;
  },
});
