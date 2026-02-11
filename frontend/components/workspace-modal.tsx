'use client';

import { Code2, Blocks, ArrowRight, Loader2, Box, ArrowLeft, Cpu, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useProject } from '@/contexts/project-context';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

// Default starter code for Arduino
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
    const loadCompilers = async () => {
      try {
        const data = await compileService.listCompilers();
        if (data?.compilers?.length) {
          setCompilers(data.compilers.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
          })));
          if (!selectedCompiler) {
            setSelectedCompiler(data.compilers[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load compilers:', err);
      }
    };

    if (open) {
      loadCompilers();
    }
  }, [open, selectedCompiler]);

  const handleSelectWorkspace = (type: 'ide' | 'blocks' | 'cad') => {
    setSelectedType(type);
    const defaultName = `My ${type === 'ide' ? 'Code' : type === 'blocks' ? 'Block' : 'CAD'} Project`;
    setProjectName(defaultName);
    // For IDE projects, show project type selection; otherwise go to name
    if (type === 'ide') {
      setStep('projectType');
    } else {
      setStep('name');
    }
  };

  const handleCreateProject = async () => {
    if (!selectedType) return;
    setIsCreating(true);
    try {
      // Create a new project
      const project = await createProject(
        projectName.trim() || `My ${selectedType === 'ide' ? 'Code' : selectedType === 'blocks' ? 'Block' : 'CAD'} Project`,
        `Created on ${new Date().toLocaleDateString()}`,
        selectedType === 'ide' ? selectedCompiler : 'arduino',
        selectedType === 'ide' ? (selectedProjectType as ProjectType) : undefined
      );
      
      // Save project ID and workspace type to localStorage
      localStorage.setItem('cubot-ide-last-project', project.id);
      localStorage.setItem(`cubot-ide-project-workspace-${project.id}`, selectedType);
      
      // Load the project to set it as current (IDE/Blocks only)
      if (selectedType !== 'cad') {
        await loadProject(project.id);
      }
      
      // Create an initial file for IDE projects
      if (selectedType === 'ide') {
        try {
          await createFile('main.ino', 'main.ino', STARTER_CODE, 'ino');
          console.log('Created initial file for project');
        } catch (fileError) {
          console.error('Failed to create initial file:', fileError);
        }
      }
      
      onOpenChange(false);
      
      // Navigate with project ID
      if (selectedType === 'ide') {
        router.push(`/ide?project=${project.id}`);
      } else if (selectedType === 'blocks') {
        router.push(`/blocks?project=${project.id}`);
      } else {
        router.push(`/cad?project=${project.id}`);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      // Fallback: navigate without project (will use mock data)
      onOpenChange(false);
      if (selectedType === 'ide') {
        router.push('/ide');
      } else if (selectedType === 'blocks') {
        router.push('/blocks');
      } else {
        router.push(`/cad?project=cad-${Date.now()}`);
      }
    } finally {
      setIsCreating(false);
      resetModal();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetModal();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-4xl border-4 border-foreground bg-background p-0 gap-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-2xl font-black text-foreground">
            {step === 'select'
              ? 'CHOOSE YOUR WORKSPACE'
              : step === 'projectType'
              ? 'CHOOSE PROJECT TYPE'
              : step === 'name'
              ? 'NAME YOUR PROJECT'
              : 'CHOOSE COMPILER'}
          </DialogTitle>
          <DialogDescription className="text-foreground/70 font-bold">
            {step === 'select'
              ? 'Select how you want to build your project'
              : step === 'projectType'
              ? 'Choose between embedded systems or robotics (ROS) development'
              : step === 'name'
              ? 'Give your project a descriptive name'
              : 'Pick the compiler target for your IDE project'}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
          {/* IDE Option */}
          <button
            onClick={() => handleSelectWorkspace('ide')}
            disabled={isCreating}
            className="group border-4 border-foreground p-6 text-left hover:bg-foreground hover:text-background transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 border-2 border-current flex items-center justify-center">
                {isCreating ? <Loader2 size={24} className="animate-spin" /> : <Code2 size={24} />}
              </div>
              <h3 className="font-black text-lg">CODE IDE</h3>
            </div>
            <p className="text-sm font-bold mb-6 opacity-80">
              Write C/C++ code with AI assistance. Full-featured code editor with syntax highlighting, autocomplete, and integrated chat.
            </p>
            <div className="flex items-center gap-2 font-black text-sm">
              <span>{isCreating ? 'CREATING PROJECT...' : 'OPEN IDE'}</span>
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Block Workspace Option */}
          <button
            onClick={() => handleSelectWorkspace('blocks')}
            disabled={isCreating}
            className="group border-4 border-foreground p-6 text-left hover:bg-foreground hover:text-background transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 border-2 border-current flex items-center justify-center">
                {isCreating ? <Loader2 size={24} className="animate-spin" /> : <Blocks size={24} />}
              </div>
              <h3 className="font-black text-lg">BLOCK WORKSPACE</h3>
            </div>
            <p className="text-sm font-bold mb-6 opacity-80">
              Visual no-code programming with drag-and-drop blocks. Perfect for beginners learning embedded concepts.
            </p>
            <div className="flex items-center gap-2 font-black text-sm">
              <span>{isCreating ? 'CREATING PROJECT...' : 'OPEN BLOCKS'}</span>
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* CAD Assistant Option */}
          <button
            onClick={() => handleSelectWorkspace('cad')}
            disabled={isCreating}
            className="group border-4 border-foreground p-6 text-left hover:bg-foreground hover:text-background transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 border-2 border-current flex items-center justify-center">
                <Box size={24} />
              </div>
              <h3 className="font-black text-lg">CAD ASSISTANT</h3>
            </div>
            <p className="text-sm font-bold mb-6 opacity-80">
              AI-powered 3D modeling assistant. Describe components in plain language and get CAD models instantly. Export to STL.
            </p>
            <div className="flex items-center gap-2 font-black text-sm">
              <span>OPEN CAD</span>
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
          </div>
        ) : step === 'projectType' ? (
          <div className="p-6">
            <div className="space-y-4">
              <div className="text-sm font-black uppercase tracking-widest text-foreground/70 mb-6">
                Select project category
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Embedded Project */}
                <button
                  onClick={() => {
                    setSelectedProjectType('embedded');
                    setStep('name');
                  }}
                  disabled={isCreating}
                  className={`border-4 p-6 text-left transition-all ${
                    selectedProjectType === 'embedded'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/30 hover:border-foreground'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="font-black text-lg">EMBEDDED</h3>
                    {selectedProjectType === 'embedded' && <CheckCircle2 size={20} />}
                  </div>
                  <p className="text-sm font-bold opacity-80 mb-4">
                    Arduino, ESP32, TI ARM projects. Traditional embedded systems programming.
                  </p>
                  <div className="text-xs font-black opacity-60">Code Editor Only</div>
                </button>

                {/* ROS Project */}
                <button
                  onClick={() => {
                    setSelectedProjectType('ros');
                    setStep('name');
                  }}
                  disabled={isCreating}
                  className={`border-4 p-6 text-left transition-all ${
                    selectedProjectType === 'ros'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/30 hover:border-foreground'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="font-black text-lg">ROS/ROS2</h3>
                    {selectedProjectType === 'ros' && <CheckCircle2 size={20} />}
                  </div>
                  <p className="text-sm font-bold opacity-80 mb-4">
                    Robotics projects with ROS support. Full Daytona terminal access for running nodes.
                  </p>
                  <div className="text-xs font-black opacity-60">✨ With Sandbox Terminal</div>
                </button>
              </div>
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep('select')}
                  disabled={isCreating}
                  className="border-2 border-foreground font-black"
                >
                  <ArrowLeft size={16} className="mr-2" />
                  BACK
                </Button>
              </div>
            </div>
          </div>
        ) : step === 'name' ? (
          <div className="p-6">
            <div className="space-y-4">
              <label className="text-sm font-black uppercase tracking-widest text-foreground/70">
                Project name
              </label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My CAD Project"
                className="border-2 border-foreground font-bold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectName.trim() && !isCreating) {
                    handleCreateProject();
                  }
                }}
              />
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep(selectedType === 'ide' ? 'projectType' : 'select')}
                  disabled={isCreating}
                  className="border-2 border-foreground font-black"
                >
                  <ArrowLeft size={16} className="mr-2" />
                  BACK
                </Button>
                {selectedType === 'ide' ? (
                  <Button
                    onClick={() => setStep('compiler')}
                    disabled={isCreating || !projectName.trim()}
                    className="border-2 border-foreground font-black"
                  >
                    <ArrowRight size={16} className="mr-2" />
                    NEXT
                  </Button>
                ) : (
                  <Button
                    onClick={handleCreateProject}
                    disabled={isCreating || !projectName.trim()}
                    className="border-2 border-foreground font-black"
                  >
                    {isCreating ? (
                      <Loader2 size={16} className="mr-2 animate-spin" />
                    ) : (
                      <ArrowRight size={16} className="mr-2" />
                    )}
                    CREATE PROJECT
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-foreground/70">
                <Cpu size={16} />
                Compiler target
              </div>
              <div className="grid grid-cols-1 gap-3">
                {(compilers.length ? compilers : [
                  { id: 'arduino', name: 'Arduino', description: 'AVR-based boards' },
                  { id: 'ti_arm', name: 'TI ARM', description: 'TI ARM toolchain' },
                  { id: 'esp32', name: 'ESP32', description: 'Espressif ESP32' },
                ]).map((compiler) => (
                  <button
                    key={compiler.id}
                    onClick={() => setSelectedCompiler(compiler.id)}
                    className={`border-2 border-foreground p-4 text-left font-bold transition-all ${
                      selectedCompiler === compiler.id
                        ? 'bg-foreground text-background'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-black">{compiler.name}</div>
                        <div className={`text-xs ${selectedCompiler === compiler.id ? 'text-background/80' : 'text-muted-foreground'}`}>
                          {compiler.description}
                        </div>
                      </div>
                      {selectedCompiler === compiler.id && (
                        <span className="text-xs font-black">SELECTED</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep('name')}
                  disabled={isCreating}
                  className="border-2 border-foreground font-black"
                >
                  <ArrowLeft size={16} className="mr-2" />
                  BACK
                </Button>
                <Button
                  onClick={handleCreateProject}
                  disabled={isCreating}
                  className="border-2 border-foreground font-black"
                >
                  {isCreating ? (
                    <Loader2 size={16} className="mr-2 animate-spin" />
                  ) : (
                    <ArrowRight size={16} className="mr-2" />
                  )}
                  CREATE PROJECT
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
