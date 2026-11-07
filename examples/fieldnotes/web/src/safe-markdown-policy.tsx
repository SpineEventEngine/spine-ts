/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import rehypeSanitize from "rehype-sanitize";
import type { ComponentProps } from "react";

/**
 * Shares HTML and image controls between saved and in-editor Markdown preview.
 */
export const safePreviewOptions = {
  /**
   * Discards embedded raw HTML before rendering.
   */
  skipHtml: true,

  /**
   * Keeps the saved preview within the sanitizer allowlist.
   */
  rehypePlugins: [rehypeSanitize],

  /**
   * Replaces outbound images and hardens external links.
   */
  components: {
    /**
     * Renders image text without making a network request.
     *
     * @param alt Image alternative text.
     * @returns Nonloading image placeholder.
     */
    img: ({ alt }: ComponentProps<"img">) => <span role="img" aria-label={alt ?? "Image omitted"}>
      Image omitted: {alt ?? "unnamed image"}
    </span>,

    /**
     * Renders an external link without referrer disclosure.
     *
     * @param children Link text.
     * @param props Safe link attributes.
     * @returns Hardened anchor.
     */
    a: ({ children, ...props }: ComponentProps<"a">) =>
      <a {...props} rel="noreferrer noopener">{children}</a>,
  },
};
