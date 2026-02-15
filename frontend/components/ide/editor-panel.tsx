'use client';

import dynamic from 'next/dynamic';
import { File, Sparkles } from 'lucide-react';
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
    <main className="h-full flex flex-col overflow-hidden bg-background">
      {currentFileName && (
        <div className="h-10 border-b border-border flex items-center justify-between px-4 bg-card">
          <div className="flex items-center gap-2">
            <File size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {currentFileName}
              {hasUnsavedChanges && <span className="ml-1.5 text-accent">●</span>}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {currentProjectName && (
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-2">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                {currentProjectName}
              </span>
            )}
            <Button
              onClick={onSave}
              size="sm"
              variant="default"
              className="h-7 px-3 font-medium"
              disabled={!hasUnsavedChanges || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        {currentFileContent !== null ? (
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
          <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="text-center max-w-md">
              <div className="w-24 h-24 mx-auto mb-6 bg-primary/10 border border-border rounded-lg flex items-center justify-center">
                <span className="text-primary text-5xl">⚙</span>
              </div>
              <h2 className="text-xl font-semibold mb-2 text-foreground">
                {currentProjectName || 'Cubot IDE'}
              </h2>
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <Sparkles size={14} />
                Select a file to start editing
              </div>
              <p className="text-muted-foreground text-sm mt-4 italic">
                Great projects start with a single file.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
