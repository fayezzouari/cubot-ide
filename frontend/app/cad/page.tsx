'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Home, Download, Code2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CadViewer from '@/components/cad/cad-viewer';
import CadChatPanel, { type CadChatMessage } from '@/components/cad/cad-chat-panel';
import { cadService } from '@/lib/api';

export default function CadPage() {
  const searchParams = useSearchParams();
  const sessionId =
    searchParams.get('project') ||
    searchParams.get('session') ||
    `cad-${Date.now()}`;

  const [messages, setMessages] = useState<CadChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStl, setCurrentStl] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const blobToBase64 = useCallback(async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  // Load session history on mount and render latest model
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await cadService.getHistory(sessionId);
        if (history.messages && history.messages.length > 0) {
          const loadedMessages: CadChatMessage[] = history.messages.map(
            (msg: any, idx: number) => ({
              id: `history-${idx}`,
              role: msg.role,
              content: msg.content,
              cadquery_code: msg.cadquery_code,
              has_model: msg.has_model,
            })
          );
          setMessages(loadedMessages);
        }

        if (history.current_code) {
          setCurrentCode(history.current_code);
          // Render the latest saved model
          try {
            const stlBlob = await cadService.exportStl(history.current_code);
            const stlB64 = await blobToBase64(stlBlob);
            setCurrentStl(stlB64);
          } catch (err) {
            console.error('Failed to render saved model:', err);
          }
        }
      } catch {
        // Session doesn't exist yet — that's fine
      }
    };
    loadHistory();
  }, [sessionId, blobToBase64]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;

    // Add user message
    const userMsg: CadChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);

    try {
      // Build conversation history for context
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await cadService.generate(sessionId, {
        message: trimmed,
        current_code: currentCode || undefined,
        conversation_history: conversationHistory,
      });

      const assistantMsg: CadChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        cadquery_code: response.cadquery_code,
        has_model: !!response.stl_base64,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (response.cadquery_code) {
        setCurrentCode(response.cadquery_code);
      }
      if (response.stl_base64) {
        setCurrentStl(response.stl_base64);
      }

      if (response.error && !response.stl_base64) {
        const errorMsg: CadChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ CadQuery execution error:\n${response.error}`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch (err: any) {
      const errorMsg: CadChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Failed to generate model: ${err.message || 'Unknown error'}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, messages, currentCode, sessionId]);

  const handleExportSTL = useCallback(async () => {
    if (!currentCode) return;
    setIsExporting(true);
    try {
      const blob = await cadService.exportStl(currentCode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.stl';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  }, [currentCode]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans">
      {/* Top bar */}
      <div className="h-12 border-b-4 border-foreground flex items-center px-4 justify-between bg-background/90 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button
              variant="ghost"
              size="icon"
              className="border-2 border-foreground w-8 h-8"
              title="Back to dashboard"
            >
              <Home size={16} />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Code2 size={18} />
            <span className="font-black text-sm tracking-wide">CUBOT CAD ASSISTANT</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleExportSTL}
            disabled={!currentCode || isExporting}
            className="px-4 py-2 bg-primary border-2 border-foreground text-primary-foreground font-black text-xs hover:bg-muted hover:text-black transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            EXPORT STL
          </Button>
        </div>
      </div>

      {/* Main content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Chat panel — left side */}
        <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
          <CadChatPanel
            messages={messages}
            input={input}
            isGenerating={isGenerating}
            onInputChange={setInput}
            onSend={handleSend}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 3D Viewer — right side */}
        <ResizablePanel defaultSize={70}>
          <CadViewer stlBase64={currentStl} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
