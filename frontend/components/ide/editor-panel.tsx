'use client';

import dynamic from 'next/dynamic';
import { File } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface EditorPanelProps {
  currentFileName: string | null;
  currentProjectName?: string | null;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  currentFileContent: string | null;
  editedContent: string;
  onChange: (value: string | undefined) => void;
  getLanguageFromFileName: (name?: string | null) => string;
}

export default function EditorPanel({
  currentFileName,
  currentProjectName,
  hasUnsavedChanges,
  isSaving,
  onSave,
  currentFileContent,
  editedContent,
  onChange,
  getLanguageFromFileName,
}: EditorPanelProps) {
  return (
    <main className="flex-1 flex flex-col overflow-hidden bg-background/90">
      {currentFileName && (
        <div className="h-10 border-b-2 border-foreground flex items-center justify-between px-2">
          <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-primary/10 to-muted border-2 border-foreground shadow-sm">
            <File size={12} />
            <span className="text-sm font-bold">
              {currentFileName}
              {hasUnsavedChanges && <span className="ml-1 text-amber-500">●</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {currentProjectName && (
              <span className="text-xs text-muted-foreground font-bold flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {currentProjectName}
              </span>
            )}
            <Button
              onClick={onSave}
              size="sm"
              variant="outline"
              className="border-2 border-foreground font-black h-7"
              disabled={!hasUnsavedChanges || isSaving}
            >
              {isSaving ? 'SAVING...' : 'SAVE'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative bg-slate-950/90">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_55%)] animate-pulse" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,_rgba(148,163,184,0.06)_1px,_transparent_1px),linear-gradient(to_bottom,_rgba(148,163,184,0.06)_1px,_transparent_1px)] bg-[size:24px_24px]" />
        {currentFileContent ? (
          <div className="w-full h-full relative z-10">
            <MonacoEditor
              value={editedContent}
              onChange={onChange}
              language={getLanguageFromFileName(currentFileName)}
              theme="vs-dark"
              options={{
                fontSize: 13,
                minimap: { enabled: true },
                wordWrap: 'on',
                smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on',
                padding: { top: 12, bottom: 12 },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'all',
                lineNumbersMinChars: 3,
                fontFamily:
                  'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
              }}
            />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-32 h-32 mx-auto mb-6 bg-primary border-4 border-foreground flex items-center justify-center">
                <span className="text-primary-foreground font-black text-6xl">⚙</span>
              </div>
              <h2 className="text-2xl font-black mb-2">CUBOT IDE</h2>
              <p className="text-muted-foreground font-bold">Select a file to start editing</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
