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
      <DialogContent className="max-w-4xl border border-border p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="text-xl font-semibold text-foreground">
            {step === 'select'
              ? 'Choose Your Workspace'
              : step === 'projectType'
              ? 'Choose Project Type'
              : step === 'name'
              ? 'Name Your Project'
              : 'Choose Compiler'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
          {/* IDE Option */}
          <button
            onClick={() => handleSelectWorkspace('ide')}
            disabled={isCreating}
            className="group border border-border rounded-lg p-5 text-left hover:border-primary/50 hover:bg-muted/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                {isCreating ? <Loader2 size={20} className="animate-spin" /> : <Code2 size={20} />}
              </div>
              <h3 className="font-semibold text-base">Code IDE</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Write C/C++ code with AI assistance. Full-featured code editor with syntax highlighting, autocomplete, and integrated chat.
            </p>
            <div className="flex items-center gap-2 font-medium text-sm text-primary">
              <span>{isCreating ? 'Creating...' : 'Open IDE'}</span>
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* Block Workspace Option */}
          <button
            onClick={() => handleSelectWorkspace('blocks')}
            disabled={isCreating}
            className="group border border-border rounded-lg p-5 text-left hover:border-primary/50 hover:bg-muted/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                {isCreating ? <Loader2 size={20} className="animate-spin" /> : <Blocks size={20} />}
              </div>
              <h3 className="font-semibold text-base">Block Workspace</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Visual no-code programming with drag-and-drop blocks. Perfect for beginners learning embedded concepts.
            </p>
            <div className="flex items-center gap-2 font-medium text-sm text-primary">
              <span>{isCreating ? 'Creating...' : 'Open Blocks'}</span>
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>

          {/* CAD Assistant Option */}
          <button
            onClick={() => handleSelectWorkspace('cad')}
            disabled={isCreating}
            className="group border border-border rounded-lg p-5 text-left hover:border-primary/50 hover:bg-muted/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                <Box size={20} />
              </div>
              <h3 className="font-semibold text-base">CAD Assistant</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              AI-powered 3D modeling assistant. Describe components in plain language and get CAD models instantly. Export to STL.
            </p>
            <div className="flex items-center gap-2 font-medium text-sm text-primary">
              <span>Open CAD</span>
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
          </div>
        ) : step === 'projectType' ? (
          <div className="p-6">
            <div className="space-y-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-4">
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
                  className={`border rounded-lg p-5 text-left transition-all cursor-pointer ${
                    selectedProjectType === 'embedded'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-base">Embedded</h3>
                    {selectedProjectType === 'embedded' && <CheckCircle2 size={18} />}
                  </div>
                  <p className={`text-sm mb-3 leading-relaxed ${
                    selectedProjectType === 'embedded' ? 'text-primary-foreground/90' : 'text-muted-foreground'
                  }`}>
                    Arduino, ESP32, TI ARM projects. Traditional embedded systems programming.
                  </p>
                  <div className={`text-xs font-medium ${
                    selectedProjectType === 'embedded' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                  }`}>
                    Code Editor Only
                  </div>
                </button>

                {/* ROS Project */}
                <button
                  onClick={() => {
                    setSelectedProjectType('ros');
                    setStep('name');
                  }}
                  disabled={isCreating}
                  className={`border rounded-lg p-5 text-left transition-all cursor-pointer ${
                    selectedProjectType === 'ros'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-base">ROS/ROS2</h3>
                    {selectedProjectType === 'ros' && <CheckCircle2 size={18} />}
                  </div>
                  <p className={`text-sm mb-3 leading-relaxed ${
                    selectedProjectType === 'ros' ? 'text-primary-foreground/90' : 'text-muted-foreground'
                  }`}>
                    Robotics projects with ROS support. Full Daytona terminal access for running nodes.
                  </p>
                  <div className={`text-xs font-medium ${
                    selectedProjectType === 'ros' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                  }`}>
                    ✨ With Sandbox Terminal
                  </div>
                </button>
              </div>
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep('select')}
                  disabled={isCreating}
                >
                  <ArrowLeft size={16} className="mr-2" />
                  Back
                </Button>
              </div>
            </div>
          </div>
        ) : step === 'name' ? (
          <div className="p-6">
            <div className="space-y-4">
              <label className="text-sm font-medium text-muted-foreground">
                Project name
              </label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My CAD Project"
                className="border border-input"
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
                >
                  <ArrowLeft size={16} className="mr-2" />
                  Back
                </Button>
                {selectedType === 'ide' ? (
                  <Button
                    onClick={() => setStep('compiler')}
                    disabled={isCreating || !projectName.trim()}
                  >
                    Next
                    <ArrowRight size={16} className="ml-2" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleCreateProject}
                    disabled={isCreating || !projectName.trim()}
                  >
                    {isCreating ? (
                      <>
                        <Loader2 size={16} className="mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        Create Project
                        <ArrowRight size={16} className="ml-2" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
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
                    className={`border rounded-lg p-4 text-left transition-all cursor-pointer ${
                      selectedCompiler === compiler.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">{compiler.name}</div>
                        <div className={`text-xs ${selectedCompiler === compiler.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                          {compiler.description}
                        </div>
                      </div>
                      {selectedCompiler === compiler.id && (
                        <CheckCircle2 size={18} />
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
                >
                  <ArrowLeft size={16} className="mr-2" />
                  Back
                </Button>
                <Button
                  onClick={handleCreateProject}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={16} className="mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      Create Project
                      <ArrowRight size={16} className="ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
