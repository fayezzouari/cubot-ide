'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        h1: ({ ...props }) => <h1 className="text-lg font-black mt-4 mb-2 break-words" {...props} />,
        h2: ({ ...props }) => <h2 className="text-base font-black mt-3 mb-2 break-words" {...props} />,
        h3: ({ ...props }) => <h3 className="text-sm font-black mt-2 mb-1 break-words" {...props} />,
        p: ({ ...props }) => <p className="mb-2 leading-relaxed break-words" style={{ wordBreak: 'break-word' }} {...props} />,
        ul: ({ ...props }) => <ul className="list-disc list-inside mb-2 space-y-1" {...props} />,
        ol: ({ ...props }) => <ol className="list-decimal list-inside mb-2 space-y-1" {...props} />,
        li: ({ ...props }) => <li className="ml-2" {...props} />,
        code: ({ inline, className, children, ...props }: any) => {
          if (inline) {
            return (
              <code
                className="px-1.5 py-0.5 bg-muted border border-foreground/20 text-xs font-mono rounded break-words"
                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              className={`block p-3 bg-muted border border-foreground/20 text-xs font-mono overflow-x-auto rounded whitespace-pre-wrap break-words ${className || ''}`}
              style={{ wordBreak: 'break-word' }}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ ...props }) => (
          <pre className="mb-2 overflow-x-auto rounded whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word' }} {...props} />
        ),
        blockquote: ({ ...props }) => (
          <blockquote className="border-l-4 border-foreground/40 pl-3 italic my-2" {...props} />
        ),
        a: ({ ...props }) => (
          <a className="text-primary underline hover:text-primary/80" {...props} />
        ),
        strong: ({ ...props }) => <strong className="font-black" {...props} />,
        em: ({ ...props }) => <em className="italic" {...props} />,
        table: ({ ...props }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full border-2 border-foreground text-xs" {...props} />
          </div>
        ),
        thead: ({ ...props }) => <thead className="bg-muted" {...props} />,
        th: ({ ...props }) => (
          <th className="border border-foreground px-2 py-1 font-black text-left" {...props} />
        ),
        td: ({ ...props }) => (
          <td className="border border-foreground px-2 py-1" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
