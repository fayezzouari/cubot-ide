'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function textOf(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return textOf((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function languageOf(className?: string): string {
  const match = /language-([\w+#-]+)/.exec(className ?? '');
  return match ? match[1] : '';
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const codeClass = (child as React.ReactElement<{ className?: string }> | null)?.props?.className;
  const language = languageOf(codeClass);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textOf(children).replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-2 rounded-lg border border-white/[0.08] bg-[#0d0d0d] overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1 border-b border-white/[0.06] bg-white/[0.02]">
        <span className="text-[10px] font-mono text-white/30">{language || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-0 p-2.5 overflow-x-auto text-[11px] leading-[1.55] font-mono [&_code]:!bg-transparent [&_code]:!p-0 [&_code]:text-[11px] whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }}>
        {children}
      </pre>
    </div>
  );
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      className={`max-w-none text-xs leading-relaxed ${className}`}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        h1: ({ ...props }) => <h1 className="text-sm font-semibold text-white/90 mt-3 mb-1.5 first:mt-0 break-words" {...props} />,
        h2: ({ ...props }) => <h2 className="text-[13px] font-semibold text-white/85 mt-3 mb-1.5 first:mt-0 break-words" {...props} />,
        h3: ({ ...props }) => <h3 className="text-xs font-semibold text-white/80 mt-2.5 mb-1 first:mt-0 break-words" {...props} />,
        h4: ({ ...props }) => <h4 className="text-xs font-semibold text-white/70 mt-2 mb-1 first:mt-0 break-words" {...props} />,
        p: ({ ...props }) => <p className="my-1.5 first:mt-0 last:mb-0 break-words" style={{ wordBreak: 'break-word' }} {...props} />,
        ul: ({ ...props }) => <ul className="my-1.5 pl-4 space-y-0.5 list-disc marker:text-white/30" {...props} />,
        ol: ({ ...props }) => <ol className="my-1.5 pl-4 space-y-0.5 list-decimal marker:text-white/30" {...props} />,
        li: ({ ...props }) => <li className="pl-0.5 [&>p]:my-0.5 [&>ul]:my-0.5 [&>ol]:my-0.5" {...props} />,
        code: ({ className: codeClass, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
          const isBlock = (codeClass ?? '').includes('language-') || textOf(children).includes('\n');
          if (isBlock) {
            return (
              <code className={`font-mono ${codeClass ?? ''}`} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code
              className="px-1 py-px rounded bg-white/[0.07] border border-white/[0.08] text-[11px] font-mono text-blue-200/90 break-words"
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        blockquote: ({ ...props }) => (
          <blockquote className="my-2 pl-3 border-l-2 border-white/20 text-white/50 italic [&>p]:my-0.5" {...props} />
        ),
        a: ({ ...props }) => (
          <a className="text-blue-300 underline decoration-blue-300/40 hover:decoration-blue-300 break-all" target="_blank" rel="noreferrer" {...props} />
        ),
        strong: ({ ...props }) => <strong className="font-semibold text-white/90" {...props} />,
        em: ({ ...props }) => <em className="italic" {...props} />,
        hr: () => <hr className="my-3 border-white/[0.08]" />,
        table: ({ ...props }) => (
          <div className="my-2 overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="min-w-full text-[11px] border-collapse" {...props} />
          </div>
        ),
        thead: ({ ...props }) => <thead className="bg-white/[0.04]" {...props} />,
        th: ({ ...props }) => (
          <th className="px-2.5 py-1.5 text-left font-semibold text-white/70 border-b border-white/[0.08] whitespace-nowrap" {...props} />
        ),
        td: ({ ...props }) => (
          <td className="px-2.5 py-1.5 align-top text-white/60 border-b border-white/[0.05]" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
