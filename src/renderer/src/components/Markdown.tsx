// assistant text: GitHub-flavoured markdown, links opening outside the app

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const text = String((children as { props?: { children?: unknown } })?.props?.children ?? '');
  return (
    <div className="code-block">
      <button className="copy" aria-label="Copy" title="Copy" onClick={() => void navigator.clipboard.writeText(text.replace(/\n$/, ''))}>
        Copy
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
