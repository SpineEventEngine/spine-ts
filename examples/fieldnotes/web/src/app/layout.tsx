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

import type { ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

/**
 * Renders the Fieldnotes document boundary with no user data in HTML metadata.
 *
 * @param props App Router child content.
 * @returns Root HTML shell.
 */
export default function RootLayout(props: { readonly children: ReactNode }): ReactNode {
  return <html lang="en"><body>{props.children}</body></html>;
}

/**
 * Public application metadata.
 */
export const metadata = {
  /**
   * Public document title.
   */
  title: "Fieldnotes",

  /**
   * Public document description without place data.
   */
  description: "A private atlas of places and notes",
};
