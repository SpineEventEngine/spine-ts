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

"use client";

import MDEditor from "@uiw/react-md-editor/nohighlight";
import { safePreviewOptions } from "./safe-markdown-policy";

/**
 * Renders one private Markdown note with external images suppressed.
 *
 * @param props Saved Markdown body.
 * @returns Sanitized note without loading image URLs.
 */
export function SafeMarkdown(props: { readonly markdown: string }): React.JSX.Element {
  return <div className="safe-markdown" data-color-mode="light">
    <MDEditor.Markdown source={props.markdown} {...safePreviewOptions} />
  </div>;
}
