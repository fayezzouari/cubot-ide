'use client';

import { Code2, Blocks, ArrowRight, Loader2, Box } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useProject } from '@/contexts/project-context';
import { useState } from 'react';
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

  const handleSelectWorkspace = async (type: 'ide' | 'blocks' | 'cad') => {
    setIsCreating(true);
    try {
      // Create a new project
      const project = await createProject(
        `My ${type === 'ide' ? 'Code' : type === 'blocks' ? 'Block' : 'CAD'} Project`,
        `Created on ${new Date().toLocaleDateString()}`,
        'arduino' // Default to Arduino
      );
      
      // Save project ID and workspace type to localStorage
      localStorage.setItem('cubot-ide-last-project', project.id);
      localStorage.setItem(`cubot-ide-project-workspace-${project.id}`, type);
      
      // Load the project to set it as current (IDE/Blocks only)
      if (type !== 'cad') {
        await loadProject(project.id);
      }
      
      // Create an initial file for IDE projects
      if (type === 'ide') {
        try {
          await createFile('main.ino', 'main.ino', STARTER_CODE, 'ino');
          console.log('Created initial file for project');
        } catch (fileError) {
          console.error('Failed to create initial file:', fileError);
        }
      }
      
      onOpenChange(false);
      
      // Navigate with project ID
      if (type === 'ide') {
        router.push(`/ide?project=${project.id}`);
      } else if (type === 'blocks') {
        router.push(`/blocks?project=${project.id}`);
      } else {
        router.push(`/cad?project=${project.id}`);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      // Fallback: navigate without project (will use mock data)
      onOpenChange(false);
      if (type === 'ide') {
        router.push('/ide');
      } else if (type === 'blocks') {
        router.push('/blocks');
      } else {
        router.push(`/cad?project=cad-${Date.now()}`);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-4 border-foreground bg-background p-0 gap-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-2xl font-black text-foreground">
            CHOOSE YOUR WORKSPACE
          </DialogTitle>
          <DialogDescription className="text-foreground/70 font-bold">
            Select how you want to build your embedded project
          </DialogDescription>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
