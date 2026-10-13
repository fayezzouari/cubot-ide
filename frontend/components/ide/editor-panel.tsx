'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { File, MessageSquarePlus, Code2 } from 'lucide-react';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

export interface EditorSelection {
  fileName: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface SelectionPos {
  top: number;
  left: number;
}

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
  onAddSelectionToChat?: (selection: EditorSelection) => void;
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
  onAddSelectionToChat,
}: EditorPanelProps) {
  const editorRef = useRef<any>(null);
  const [selectionPos, setSelectionPos] = useState<SelectionPos | null>(null);
  const selectionRef = useRef<any>(null);

  const updateFloatingButton = (editor: any) => {
    const sel = editor.getSelection();
    if (!sel || sel.isEmpty()) {
      setSelectionPos(null);
      selectionRef.current = null;
      return;
    }
    selectionRef.current = sel;
    const pos = editor.getScrolledVisiblePosition(sel.getStartPosition());
    if (pos) {
      setSelectionPos({ top: Math.max(0, pos.top - 36), left: pos.left });
    } else {
      setSelectionPos(null);
    }
  };

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
    editor.onDidChangeCursorSelection(() => updateFloatingButton(editor));
    editor.onDidScrollChange(() => {
      if (selectionRef.current) updateFloatingButton(editor);
    });
  };

  const handleAddToChat = () => {
    if (!editorRef.current || !currentFileName || !onAddSelectionToChat) return;
    const editor = editorRef.current;
    const sel = editor.getSelection();
    if (!sel || sel.isEmpty()) return;
    const content = editor.getModel()?.getValueInRange(sel) ?? '';
    onAddSelectionToChat({ fileName: currentFileName, startLine: sel.startLineNumber, endLine: sel.endLineNumber, content });
    setSelectionPos(null);
  };

  return (
    <main className="h-full flex flex-col overflow-hidden bg-[#0e0e0e]">

      {/* Tab bar */}
      {currentFileName && (
        <div className="h-9 border-b border-white/[0.06] flex items-center justify-between px-3 bg-black flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <File size={12} className="text-white/25 flex-shrink-0" />
            <span className="text-xs font-mono text-white/60">
              {currentFileName}
            </span>
            {hasUnsavedChanges && (
              <span className="w-1.5 h-1.5 rounded-full bg-white/30 flex-shrink-0" title="Unsaved changes" />
            )}
          </div>
          <div className="flex items-center gap-3">
            {currentProjectName && (
              <span className="text-[11px] text-white/20 font-mono hidden sm:block">{currentProjectName}</span>
            )}
            <button
              onClick={onSave}
              disabled={!hasUnsavedChanges || isSaving}
              className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium bg-white/[0.06] hover:bg-white/[0.10] disabled:opacity-25 text-white/60 hover:text-white rounded-md transition-all cursor-pointer disabled:cursor-default"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        {currentFileContent !== null ? (
          <div className="w-full h-full relative z-10">
            <MonacoEditor
              value={editedContent}
              onChange={onChange}
              onMount={handleEditorMount}
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

            {/* Floating "Add to chat" button */}
            {selectionPos && onAddSelectionToChat && (
              <button
                onMouseDown={e => { e.preventDefault(); handleAddToChat(); }}
                style={{ top: selectionPos.top, left: selectionPos.left }}
                className="absolute z-20 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-white/70 bg-[#1e1e1e] border border-white/[0.10] rounded-md shadow-lg shadow-black/50 hover:bg-[#2a2a2a] hover:border-white/20 hover:text-white transition-all pointer-events-auto select-none"
              >
                <MessageSquarePlus size={11} />
                Add to chat
              </button>
            )}
          </div>
        ) : (
          /* Empty state */
          <div className="w-full h-full flex items-center justify-center bg-[#0e0e0e]">
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center mx-auto mb-3">
                <Code2 size={18} className="text-white/15" />
              </div>
              <p className="text-xs font-medium text-white/25">
                {currentProjectName || 'No project loaded'}
              </p>
              <p className="text-[11px] text-white/15 mt-1">Select a file to start editing</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
