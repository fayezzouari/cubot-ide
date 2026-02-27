'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { Home, Download, Box, Loader2, Cpu } from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import CadViewer from '@/components/cad/cad-viewer';
import CadChatPanel, { type CadChatMessage } from '@/components/cad/cad-chat-panel';
import { cadService } from '@/lib/api';
import type { CadSSEEvent, PlanStepState } from '@/lib/api/types';

type PlanPhase = 'planning' | 'executing' | 'assembling' | 'complete' | null;

export default function CadPageContent() {
  const { data: session } = useSession();
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

  // Plan state
  const [planSteps, setPlanSteps] = useState<PlanStepState[]>([]);
  const [planPhase, setPlanPhase] = useState<PlanPhase>(null);

  const blobToBase64 = useCallback(async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await cadService.getHistory(sessionId);
        if (history.messages?.length) {
          setMessages(history.messages.map((msg: any, idx: number) => ({
            id: `history-${idx}`,
            role: msg.role,
            content: msg.content,
            cadquery_code: msg.cadquery_code,
            has_model: msg.has_model,
          })));
        }
        if (history.current_code) {
          setCurrentCode(history.current_code);
          try {
            const stlBlob = await cadService.exportStl(history.current_code);
            setCurrentStl(await blobToBase64(stlBlob));
          } catch {}
        }
      } catch {}
    };
    loadHistory();
  }, [sessionId, blobToBase64]);

  const handleSSEEvent = useCallback((event: CadSSEEvent) => {
    switch (event.type) {
      case 'planning':
        setPlanPhase('planning');
        setPlanSteps([]);
        break;

      case 'plan_ready':
        setPlanPhase('executing');
        setPlanSteps(
          (event.parts ?? []).map(p => ({
            ...p,
            status: 'pending' as const,
          }))
        );
        break;

      case 'executing_part':
        setPlanSteps(prev =>
          prev.map(s => s.id === event.part_id ? { ...s, status: 'running' } : s)
        );
        break;

      case 'reflecting':
        setPlanSteps(prev =>
          prev.map(s =>
            s.id === event.part_id
              ? { ...s, status: 'running', attempts: event.attempt, error: event.error }
              : s
          )
        );
        break;

      case 'part_result':
        setPlanSteps(prev =>
          prev.map(s =>
            s.id === event.part_id
              ? {
                  ...s,
                  status: event.success ? 'success' : 'failed',
                  attempts: event.attempts,
                  stl_base64: event.stl_base64,
                  error: event.success ? undefined : event.error,
                }
              : s
          )
        );
        // Update viewer with each successful part preview
        if (event.success && event.stl_base64) {
          setCurrentStl(event.stl_base64);
        }
        break;

      case 'complete':
        setPlanPhase('complete');
        if (event.stl_base64) setCurrentStl(event.stl_base64);
        if (event.cadquery_code) setCurrentCode(event.cadquery_code);
        if (event.message) {
          setMessages(prev => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: event.message!,
              cadquery_code: event.cadquery_code,
              has_model: !!event.stl_base64,
            },
          ]);
        }
        break;

      case 'error':
        setPlanPhase(null);
        setMessages(prev => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: event.message ?? 'An error occurred.',
          },
        ]);
        break;
    }
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;

    const userMsg: CadChatMessage = { id: `user-${Date.now()}`, role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsGenerating(true);
    setPlanPhase(null);
    setPlanSteps([]);

    try {
      await cadService.generatePlanned(
        sessionId,
        {
          message: trimmed,
          current_code: currentCode || undefined,
          conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
        },
        handleSSEEvent,
      );
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Failed to generate model: ${err.message || 'Unknown error'}`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, messages, currentCode, sessionId, handleSSEEvent]);

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
    <div className="h-screen flex flex-col bg-black text-foreground font-sans">

      {/* Top bar */}
      <header className="h-11 border-b border-white/[0.06] flex items-center justify-between px-4 bg-black flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <img src="/cubot.svg" alt="CuBot" className="w-8 h-8 object-contain" />

            <span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">CuBot</span>
          </Link>
          <span className="text-white/[0.12]">·</span>
          <span className="text-xs text-white/30 font-mono">CAD</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportSTL}
            disabled={!currentCode || isExporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 font-medium text-xs rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            Export STL
          </button>
          <span className="w-px h-4 bg-white/[0.08] mx-1" />
         <Link
            href="/dashboard"
            className="w-7 h-7 flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] rounded-lg transition-all"
          >
            <Home size={13} />
          </Link>
          {session?.user?.image && (
            <Image
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={24}
              height={24}
              className="rounded-full border border-white/10"
            />
          )}

        </div>
      </header>

      {/* Main content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
          <CadChatPanel
            messages={messages}
            input={input}
            isGenerating={isGenerating}
            onInputChange={setInput}
            onSend={handleSend}
            planSteps={planSteps}
            planPhase={planPhase}
          />
        </ResizablePanel>
        <ResizableHandle className="bg-white/[0.04] hover:bg-white/[0.08] transition-colors w-px" />
        <ResizablePanel defaultSize={70}>
          <CadViewer
            assemblyParts={planSteps
              .filter(s => s.status === 'success' && s.stl_base64)
              .map(s => ({ id: s.id, name: s.name, stl_base64: s.stl_base64! }))}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
