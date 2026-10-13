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
  /** `pixel` inherits the parent's pixel font and draws hard notched borders. */
  variant?: 'default' | 'pixel';
}

function textOf(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return textOf((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function CodeBlock({ children, pixel }: { children: React.ReactNode; pixel: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textOf(children).replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context); nothing to do
    }
  };
  return (
    <div className="group relative mb-2">
      <pre
        className={
          pixel
            ? 'pixel-border overflow-x-auto bg-black p-2.5 text-[0.9em] leading-[1.2] whitespace-pre-wrap break-words'
            : 'overflow-x-auto rounded-lg border border-white/[0.08] bg-black/60 p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words'
        }
        style={{ wordBreak: 'break-word' }}
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className={
          pixel
            ? 'pixel-border absolute right-2 top-2 flex h-5 w-5 items-center justify-center bg-black text-white/50 opacity-0 hover:text-white group-hover:opacity-100 cursor-pointer'
            : 'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-[#151515] text-white/40 opacity-0 transition-opacity hover:text-white/80 group-hover:opacity-100 cursor-pointer'
        }
      >
        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      </button>
    </div>
  );
}

export default function MarkdownRenderer({ content, className = '', variant = 'default' }: MarkdownRendererProps) {
  const pixel = variant === 'pixel';
  return (
    <ReactMarkdown
      className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        h1: ({ ...props }) => <h1 className={pixel ? 'font-pixel text-[0.7em] uppercase mt-3 mb-1.5 break-words' : 'text-base font-bold mt-3 mb-1.5 break-words'} {...props} />,
        h2: ({ ...props }) => <h2 className={pixel ? 'font-pixel text-[0.6em] uppercase mt-3 mb-1.5 break-words' : 'text-[13px] font-bold mt-3 mb-1.5 break-words'} {...props} />,
        h3: ({ ...props }) => <h3 className={pixel ? 'font-pixel text-[0.55em] uppercase mt-2 mb-1 break-words' : 'text-xs font-bold mt-2 mb-1 break-words'} {...props} />,
        p: ({ ...props }) => <p className="mb-2 last:mb-0 leading-relaxed break-words" style={{ wordBreak: 'break-word' }} {...props} />,
        ul: ({ ...props }) => <ul className={pixel ? 'list-["▪_"] pl-4 mb-2 space-y-0.5' : 'list-disc pl-4 mb-2 space-y-1'} {...props} />,
        ol: ({ ...props }) => <ol className="list-decimal pl-4 mb-2 space-y-1" {...props} />,
        li: ({ ...props }) => <li className="pl-0.5" {...props} />,
        // react-markdown no longer passes `inline`; a code node is a block only when it sits in a fenced block.
        code: ({ className: codeClass, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
          const isBlock = (codeClass ?? '').includes('language-') || textOf(children).includes('\n');
          if (!isBlock) {
            return (
              <code
                className={
                  pixel
                    ? 'font-pixel-body bg-white/[0.08] px-1 text-[1em] text-amber-200 break-words'
                    : 'rounded border border-white/[0.1] bg-white/[0.06] px-1 py-px font-mono text-[11px] text-amber-100/90 break-words'
                }
                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={`${pixel ? 'font-pixel-body !bg-transparent' : 'font-mono'} ${codeClass ?? ''}`} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => <CodeBlock pixel={pixel}>{children}</CodeBlock>,
        blockquote: ({ ...props }) => (
          <blockquote className="border-l-2 border-amber-400/40 pl-3 italic my-2 text-white/60" {...props} />
        ),
        a: ({ ...props }) => (
          <a className="text-amber-200 underline decoration-amber-200/40 hover:decoration-amber-200" target="_blank" rel="noreferrer" {...props} />
        ),
        strong: ({ ...props }) => <strong className={pixel ? 'text-amber-200' : 'font-semibold text-white/90'} {...props} />,
        em: ({ ...props }) => <em className="italic" {...props} />,
        table: ({ ...props }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full border border-white/[0.1] text-xs" {...props} />
          </div>
        ),
        thead: ({ ...props }) => <thead className="bg-white/[0.04]" {...props} />,
        th: ({ ...props }) => (
          <th className="border border-white/[0.1] px-2 py-1 font-semibold text-left" {...props} />
        ),
        td: ({ ...props }) => (
          <td className="border border-white/[0.1] px-2 py-1" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
