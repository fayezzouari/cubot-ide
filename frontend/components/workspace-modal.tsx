'use client';

import { Code2, Blocks, ArrowRight, Loader2, Box, ArrowLeft, Cpu, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useProject } from '@/contexts/project-context';
import { useEffect, useState } from 'react';
import { compileService } from '@/lib/api';
import type { ProjectType } from '@/lib/api/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface WorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STARTER_CODE = `// Arduino Starter Code
// Created with CuBot IDE

void setup() {
  // Initialize serial communication
  Serial.begin(9600);

  // Set pin 13 as output (built-in LED)
  pinMode(13, OUTPUT);

  Serial.println("CuBot IDE - Ready!");
}

void loop() {
  // Blink the LED
  digitalWrite(13, HIGH);
  delay(1000);

  digitalWrite(13, LOW);
  delay(1000);
}
`;

const WORKSPACE_OPTIONS = [
  {
    id: 'ide' as const,
    label: 'Code IDE',
    icon: Code2,
    description: 'Write C/C++ with AI assistance, syntax highlighting, and an integrated chat.',
  },
  {
    id: 'blocks' as const,
    label: 'Block Workspace',
    icon: Blocks,
    description: 'Visual no-code programming with drag-and-drop blocks for beginners.',
  },
  {
    id: 'cad' as const,
    label: 'CAD Assistant',
    icon: Box,
    description: 'AI-powered 3D modeling. Describe parts in plain language, export to STL.',
  },
];

const PROJECT_TYPES = [
  {
    id: 'embedded' as const,
    label: 'Embedded',
    description: 'Arduino, ESP32, TI ARM and other microcontroller projects.',
    badge: 'Code Editor',
  },
  {
    id: 'ros' as const,
    label: 'ROS / ROS2',
    description: 'Robotics projects with full Daytona terminal access for running nodes.',
    badge: '✦ Sandbox Terminal',
  },
];

const STEP_TITLES: Record<string, string> = {
  select:      'New project',
  projectType: 'Project type',
  name:        'Name your project',
  compiler:    'Compiler target',
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  select:      'Choose a workspace to get started',
  projectType: 'Choose between embedded systems or robotics development',
  name:        'Give your project a descriptive name',
  compiler:    'Pick the compiler target for your project',
};

export default function WorkspaceModal({ open, onOpenChange }: WorkspaceModalProps) {
  const router = useRouter();
  const { createProject, createFile, loadProject } = useProject();
  const [isCreating, setIsCreating] = useState(false);
  const [step, setStep] = useState<'select' | 'projectType' | 'name' | 'compiler'>('select');
  const [selectedType, setSelectedType] = useState<'ide' | 'blocks' | 'cad' | null>(null);
  const [selectedProjectType, setSelectedProjectType] = useState<'embedded' | 'ros'>('embedded');
  const [projectName, setProjectName] = useState('');
  const [compilers, setCompilers] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [selectedCompiler, setSelectedCompiler] = useState('arduino');

  const resetModal = () => {
    setStep('select');
    setSelectedType(null);
    setSelectedProjectType('embedded');
    setProjectName('');
    setSelectedCompiler('arduino');
  };

  useEffect(() => {
    if (!open) return;
    compileService.listCompilers().then(data => {
      if (data?.compilers?.length) {
        setCompilers(data.compilers.map(c => ({ id: c.id, name: c.name, description: c.description })));
      }
    }).catch(() => {});
  }, [open]);

  const handleSelectWorkspace = (type: 'ide' | 'blocks' | 'cad') => {
    setSelectedType(type);
    setProjectName(`My ${type === 'ide' ? 'Code' : type === 'blocks' ? 'Block' : 'CAD'} Project`);
    setStep(type === 'ide' ? 'projectType' : 'name');
  };

  const handleCreateProject = async () => {
    if (!selectedType) return;
    setIsCreating(true);
    let newProjectId: string | null = null;
    try {
      const project = await createProject(
        projectName.trim() || `My ${selectedType === 'ide' ? 'Code' : selectedType === 'blocks' ? 'Block' : 'CAD'} Project`,
        `Created on ${new Date().toLocaleDateString()}`,
        selectedType === 'ide' ? selectedCompiler : 'arduino',
        selectedType === 'ide' ? (selectedProjectType as ProjectType) : undefined,
      );
      newProjectId = project.id;
      localStorage.setItem('cubot-ide-last-project', project.id);
      localStorage.setItem(`cubot-ide-project-workspace-${project.id}`, selectedType);

      if (selectedType !== 'cad') await loadProject(project.id);

      if (selectedType === 'ide' && selectedProjectType !== 'ros') {
        try { await createFile('main.ino', 'main.ino', STARTER_CODE, 'ino'); } catch {}
      }

      onOpenChange(false);
      if (selectedType === 'ide') router.push(`/ide?project=${project.id}`);
      else if (selectedType === 'blocks') router.push(`/blocks?project=${project.id}`);
      else router.push(`/cad?project=${project.id}`);
    } catch {
      onOpenChange(false);
      if (selectedType === 'ide') router.push(newProjectId ? `/ide?project=${newProjectId}` : '/dashboard');
      else if (selectedType === 'blocks') router.push(newProjectId ? `/blocks?project=${newProjectId}` : '/dashboard');
      else router.push(newProjectId ? `/cad?project=${newProjectId}` : '/dashboard');
    } finally {
      setIsCreating(false);
      resetModal();
    }
  };

  const fallbackCompilers = [
    { id: 'arduino', name: 'Arduino', description: 'AVR-based boards (Uno, Nano, Pro Mini)' },
    { id: 'ti_arm',  name: 'TI ARM',  description: 'Texas Instruments ARM toolchain' },
    { id: 'esp32',   name: 'ESP32',   description: 'Espressif ESP32 / ESP-IDF' },
  ];
  const compilerList = compilers.length ? compilers : fallbackCompilers;

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) resetModal(); onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-lg bg-[#0e0e0e] border border-white/[0.08] rounded-xl p-0 gap-0 shadow-2xl overflow-hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-sm font-semibold text-white leading-none">
                {STEP_TITLES[step]}
              </DialogTitle>
              <DialogDescription className="text-xs text-white/40 mt-0.5">
                {STEP_DESCRIPTIONS[step]}
              </DialogDescription>
            </div>
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {(['select', 'projectType', 'name', 'compiler'] as const).filter(s => selectedProjectType !== 'ros' || s !== 'compiler').map((s, i) => {
                const steps = selectedProjectType === 'ros'
                  ? ['select', 'projectType', 'name']
                  : ['select', 'projectType', 'name', 'compiler'];
                const current = steps.indexOf(step);
                const isDone = i < current;
                const isActive = i === current;
                return (
                  <span key={s} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    isActive ? 'bg-white' : isDone ? 'bg-white/40' : 'bg-white/[0.12]'
                  }`} />
                );
              })}
            </div>
          </div>
        </DialogHeader>

        {/* ── Step: select workspace ── */}
        {step === 'select' && (
          <div className="p-4 grid grid-cols-3 gap-2.5">
            {WORKSPACE_OPTIONS.map(opt => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSelectWorkspace(opt.id)}
                  disabled={isCreating}
                  className="group flex flex-col gap-3 p-4 rounded-xl border border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.03] text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] flex items-center justify-center">
                    <Icon size={15} className="text-white/60 group-hover:text-white/90 transition-colors" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/80 group-hover:text-white transition-colors leading-tight">
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-white/30 mt-1 leading-relaxed">{opt.description}</p>
                  </div>
                  <div className="mt-auto flex items-center gap-1 text-[11px] text-white/25 group-hover:text-white/50 transition-colors">
                    Select <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Step: project type ── */}
        {step === 'projectType' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              {PROJECT_TYPES.map(pt => {
                const selected = selectedProjectType === pt.id;
                return (
                  <button
                    key={pt.id}
                    onClick={() => { setSelectedProjectType(pt.id); setStep('name'); }}
                    disabled={isCreating}
                    className={`flex flex-col gap-2 p-4 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 ${
                      selected
                        ? 'border-white/30 bg-white/[0.06]'
                        : 'border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-semibold text-white/80">{pt.label}</p>
                      {selected && <CheckCircle2 size={13} className="text-white/60 flex-shrink-0" />}
                    </div>
                    <p className="text-[11px] text-white/30 leading-relaxed">{pt.description}</p>
                    <span className="text-[10px] font-medium text-white/25 px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.03] w-fit">
                      {pt.badge}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="pt-1">
              <button
                onClick={() => setStep('select')}
                disabled={isCreating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/40 hover:text-white text-xs font-medium rounded-lg transition-all cursor-pointer disabled:opacity-30"
              >
                <ArrowLeft size={12} /> Back
              </button>
            </div>
          </div>
        )}

        {/* ── Step: name ── */}
        {step === 'name' && (
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Project name</label>
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="My Project"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && projectName.trim() && !isCreating) {
                    if (selectedType === 'ide' && selectedProjectType !== 'ros') setStep('compiler');
                    else handleCreateProject();
                  }
                }}
                className="w-full bg-[#161616] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setStep(selectedType === 'ide' ? 'projectType' : 'select')}
                disabled={isCreating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/40 hover:text-white text-xs font-medium rounded-lg transition-all cursor-pointer disabled:opacity-30"
              >
                <ArrowLeft size={12} /> Back
              </button>
              {selectedType === 'ide' && selectedProjectType !== 'ros' ? (
                <button
                  onClick={() => setStep('compiler')}
                  disabled={isCreating || !projectName.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 text-xs font-medium rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  Next <ArrowRight size={12} />
                </button>
              ) : (
                <button
                  onClick={handleCreateProject}
                  disabled={isCreating || !projectName.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 text-xs font-medium rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {isCreating ? <><Loader2 size={12} className="animate-spin" />Creating…</> : <>Create <ArrowRight size={12} /></>}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step: compiler ── */}
        {step === 'compiler' && (
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              {compilerList.map(compiler => {
                const selected = selectedCompiler === compiler.id;
                return (
                  <button
                    key={compiler.id}
                    onClick={() => setSelectedCompiler(compiler.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all cursor-pointer ${
                      selected
                        ? 'border-white/30 bg-white/[0.06]'
                        : 'border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.03]'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-semibold text-white/80">{compiler.name}</p>
                      <p className="text-[11px] text-white/30 mt-0.5">{compiler.description}</p>
                    </div>
                    {selected && <CheckCircle2 size={14} className="text-white/60 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setStep('name')}
                disabled={isCreating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-white/40 hover:text-white text-xs font-medium rounded-lg transition-all cursor-pointer disabled:opacity-30"
              >
                <ArrowLeft size={12} /> Back
              </button>
              <button
                onClick={handleCreateProject}
                disabled={isCreating}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white hover:bg-white/90 disabled:bg-white/20 text-black disabled:text-white/30 text-xs font-medium rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {isCreating
                  ? <><Loader2 size={12} className="animate-spin" />Creating…</>
                  : <>Create project <ArrowRight size={12} /></>
                }
              </button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
