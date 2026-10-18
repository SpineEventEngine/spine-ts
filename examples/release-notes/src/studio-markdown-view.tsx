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

import { useMemo, useState, type ReactElement } from "react";
import { ArrowLeft, Copy, Download } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import ReactMarkdown from "react-markdown";

interface MarkdownWorkspaceProps {
  title: string;
  subtitle?: string;
  markdown: string;
  saveState: string;
  exportDisabled?: boolean;
  editorDisabled?: boolean;
  onMarkdownChange: (value: string) => void;
  onCopy: () => void;
  onExport: () => void;
  onDashboard: () => void;
}

const WorkspaceHeading = ({
  title,
  subtitle,
  saveState,
  exportDisabled,
  onExport,
}: MarkdownWorkspaceProps): ReactElement => (
  <div className="rs-editor-heading">
    <div>
      <h1>{title}</h1>
      {subtitle && <p className="rs-editor-subtitle">{subtitle}</p>}
      <p className="rs-editor-save-state" role="status">
        {saveState}
      </p>
    </div>
    <button type="button" className="rs-primary" disabled={exportDisabled} onClick={onExport}>
      <Download aria-hidden="true" size={17} /> Export
    </button>
  </div>
);

const WorkspaceTabs = ({ onCopy }: { onCopy: () => void }): ReactElement => (
  <div className="rs-editor-tabs">
    <Tabs.List className="rs-editor-tablist" aria-label="Document view">
      <Tabs.Trigger value="markdown">Markdown</Tabs.Trigger>
      <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
    </Tabs.List>
    <button
      type="button"
      className="rs-copy"
      aria-label="Copy Markdown"
      title="Copy Markdown"
      onClick={onCopy}
    >
      <Copy aria-hidden="true" size={16} />
    </button>
  </div>
);

const markdownLineCount = (markdown: string): number => {
  let count = 1;
  for (let index = 0; index < markdown.length; index++) {
    if (markdown.charCodeAt(index) === 10) count++;
  }
  return count;
};

const EditorGutter = ({
  firstLine,
  visibleLines,
  offset,
  lineDigits,
}: {
  firstLine: number;
  visibleLines: number;
  offset: number;
  lineDigits: number;
}): ReactElement => (
  <div
    className="rs-line-numbers"
    aria-hidden="true"
    style={{
      width: `${String(lineDigits + 2)}ch`,
      transform: `translateY(-${String(offset)}px)`,
    }}
  >
    {Array.from({ length: visibleLines }, (_, index) => (
      <span key={firstLine + index}>{firstLine + index + 1}</span>
    ))}
  </div>
);

const MarkdownEditor = ({
  markdown,
  editorDisabled,
  onMarkdownChange,
}: MarkdownWorkspaceProps): ReactElement => {
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = useMemo(() => Math.max(12, markdownLineCount(markdown)), [markdown]);
  const lineHeight = 24;
  const firstLine = Math.min(lineCount - 1, Math.max(0, Math.floor(scrollTop / lineHeight)));
  const visibleLines = Math.min(24, lineCount - firstLine);
  return (
    <div className="rs-code-editor">
      <EditorGutter
        firstLine={firstLine}
        visibleLines={visibleLines}
        offset={scrollTop % lineHeight}
        lineDigits={String(lineCount).length}
      />
      <textarea
        aria-label="Markdown"
        spellCheck={false}
        wrap="off"
        rows={12}
        disabled={editorDisabled}
        value={markdown}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onChange={(event) => {
          onMarkdownChange(event.target.value);
        }}
      />
    </div>
  );
};

const MarkdownPreview = ({ markdown }: { markdown: string }): ReactElement => (
  <article className="rs-markdown-preview">
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ children, href }) => (
          <span>
            {children} {href && <small>({href})</small>}
          </span>
        ),
        img: ({ alt, src }) => (
          <span>
            Image: {alt ?? "Untitled image"} {src && <small>({src})</small>}
          </span>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  </article>
);

/**
 * Renders the exact Markdown buffer for editing, preview, copy, and export.
 *
 * @param props Current document and accessible workspace actions.
 * @returns The final editor and safe preview.
 */
export const MarkdownWorkspaceView = (props: MarkdownWorkspaceProps): ReactElement => {
  const [tab, setTab] = useState<"markdown" | "preview">("markdown");
  return (
    <section className="rs-editor">
      <button type="button" className="rs-back-link" onClick={props.onDashboard}>
        <ArrowLeft aria-hidden="true" size={16} /> Dashboard
      </button>
      <WorkspaceHeading {...props} />
      <Tabs.Root
        className="rs-editor-frame"
        value={tab}
        onValueChange={(value) => {
          setTab(value as "markdown" | "preview");
        }}
      >
        <WorkspaceTabs onCopy={props.onCopy} />
        <Tabs.Content value="markdown">
          <MarkdownEditor {...props} />
        </Tabs.Content>
        <Tabs.Content value="preview">
          <MarkdownPreview markdown={props.markdown} />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
};
