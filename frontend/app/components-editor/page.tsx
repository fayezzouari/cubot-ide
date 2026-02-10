'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Save, Play, Home, Trash2, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { componentsApi, ComponentType, PinType, type Component } from '@/lib/api/components';

// Dynamic import for Monaco Editor
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const DEFAULT_SENSOR_CODE = `# Sensor Component Script

import random
import math

def init(context):
    """Initialize the sensor"""
    return {
        "state": {
            "value": 0,
            "last_update": 0
        }
    }

def update(context):
    """Update sensor state each tick"""
    time = context["time"]
    
    # Your sensor logic here
    value = random.randint(0, 1023)
    
    return {
        "state": {
            "value": value,
            "last_update": time
        },
        "pin_outputs": {
            "OUT": value
        },
        "serial": f"Sensor: {value}"
    }
`;

const DEFAULT_ACTUATOR_CODE = `# Actuator Component Script

def init(context):
    """Initialize the actuator"""
    return {
        "state": {
            "active": False,
            "value": 0
        }
    }

def update(context):
    """Update actuator state based on input"""
    # Read input from Arduino pin
    input_value = context["pin_values"].get("IN", 0)
    
    return {
        "state": {
            "active": input_value > 0,
            "value": input_value
        }
    }
`;

export default function ComponentsEditorPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [componentType, setComponentType] = useState<ComponentType>(ComponentType.SENSOR);
  const [code, setCode] = useState(DEFAULT_SENSOR_CODE);
  const [pins, setPins] = useState<Array<{ name: string; pin_type: PinType; description: string }>>([
    { name: 'VCC', pin_type: PinType.DIGITAL, description: 'Power supply' },
    { name: 'GND', pin_type: PinType.DIGITAL, description: 'Ground' },
    { name: 'OUT', pin_type: PinType.ANALOG, description: 'Data output' },
  ]);

  useEffect(() => {
    loadComponents();
  }, []);

  const loadComponents = async () => {
    try {
      const data = await componentsApi.getComponents();
      setComponents(data);
    } catch (error) {
      console.error('Failed to load components:', error);
      toast.error('Failed to load components');
    }
  };

  const handleNewComponent = () => {
    setSelectedComponent(null);
    setIsEditing(true);
    setName('');
    setDescription('');
    setComponentType(ComponentType.SENSOR);
    setCode(DEFAULT_SENSOR_CODE);
    setPins([
      { name: 'VCC', pin_type: PinType.DIGITAL, description: 'Power supply' },
      { name: 'GND', pin_type: PinType.DIGITAL, description: 'Ground' },
      { name: 'OUT', pin_type: PinType.ANALOG, description: 'Data output' },
    ]);
  };

  const handleSelectComponent = (component: Component) => {
    setSelectedComponent(component);
    setIsEditing(true);
    setName(component.name);
    setDescription(component.description || '');
    setComponentType(component.component_type);
    setCode(component.script.code);
    setPins(component.pins.map(p => ({
      name: p.name,
      pin_type: p.pin_type,
      description: p.description || ''
    })));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Component name is required');
      return;
    }

    setIsSaving(true);
    try {
      const componentData = {
        name,
        description,
        component_type: componentType,
        pins: pins.map(p => ({
          name: p.name,
          pin_type: p.pin_type,
          description: p.description,
          default_value: 0,
        })),
        script: {
          language: 'python',
          code,
          entry_point: 'main',
        },
        properties: {},
      };

      if (selectedComponent?.id) {
        await componentsApi.updateComponent(selectedComponent.id, componentData);
        toast.success('Component updated');
      } else {
        await componentsApi.createComponent(componentData);
        toast.success('Component created');
      }

      await loadComponents();
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save component:', error);
      toast.error('Failed to save component');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this component?')) return;

    try {
      await componentsApi.deleteComponent(id);
      toast.success('Component deleted');
      await loadComponents();
      if (selectedComponent?.id === id) {
        setIsEditing(false);
        setSelectedComponent(null);
      }
    } catch (error) {
      console.error('Failed to delete component:', error);
      toast.error('Failed to delete component');
    }
  };

  const addPin = () => {
    setPins([...pins, { name: '', pin_type: PinType.DIGITAL, description: '' }]);
  };

  const removePin = (index: number) => {
    setPins(pins.filter((_, i) => i !== index));
  };

  const updatePin = (index: number, field: string, value: any) => {
    const newPins = [...pins];
    newPins[index] = { ...newPins[index], [field]: value };
    setPins(newPins);
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="h-14 border-b-4 border-foreground flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary border-2 border-foreground flex items-center justify-center">
              <span className="text-primary-foreground font-black text-sm">⚙</span>
            </div>
            <span className="font-serif text-xl font-black">COMPONENT EDITOR</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-2 border-foreground font-black"
            onClick={handleNewComponent}
          >
            <Plus size={14} />
            NEW
          </Button>
          {isEditing && (
            <Button
              variant="outline"
              size="sm"
              className="border-2 border-foreground font-black"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save size={14} />
              {isSaving ? 'SAVING...' : 'SAVE'}
            </Button>
          )}
          <Link href="/">
            <Button variant="ghost" size="icon">
              <Home size={18} />
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Components List */}
        <aside className="w-64 border-r-4 border-foreground flex flex-col">
          <div className="p-3 border-b-2 border-foreground">
            <span className="font-black text-sm">COMPONENTS</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-2">
              {components.map((component) => (
                <Card
                  key={component.id}
                  className={`cursor-pointer hover:bg-muted transition-colors ${
                    selectedComponent?.id === component.id ? 'border-primary' : ''
                  }`}
                  onClick={() => handleSelectComponent(component)}
                >
                  <CardHeader className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm">{component.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {component.component_type}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(component.id!);
                        }}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Editor */}
        <div className="flex-1 flex flex-col">
          {isEditing ? (
            <Tabs defaultValue="general" className="flex-1 flex flex-col">
              <TabsList className="w-full justify-start border-b-2 border-foreground rounded-none">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="pins">Pins</TabsTrigger>
                <TabsTrigger value="script">Script</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="flex-1 p-4 space-y-4">
                <div>
                  <Label htmlFor="name">Component Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Temperature Sensor"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what this component does..."
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="type">Component Type</Label>
                  <Select
                    value={componentType}
                    onValueChange={(value) => {
                      setComponentType(value as ComponentType);
                      setCode(value === ComponentType.SENSOR ? DEFAULT_SENSOR_CODE : DEFAULT_ACTUATOR_CODE);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ComponentType.SENSOR}>Sensor</SelectItem>
                      <SelectItem value={ComponentType.ACTUATOR}>Actuator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="pins" className="flex-1 p-4">
                <ScrollArea className="h-full">
                  <div className="space-y-4">
                    {pins.map((pin, index) => (
                      <Card key={index}>
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>Pin {index + 1}</Label>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removePin(index)}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                          <Input
                            placeholder="Pin name (e.g., VCC, DATA)"
                            value={pin.name}
                            onChange={(e) => updatePin(index, 'name', e.target.value)}
                          />
                          <Select
                            value={pin.pin_type}
                            onValueChange={(value) => updatePin(index, 'pin_type', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={PinType.DIGITAL}>Digital</SelectItem>
                              <SelectItem value={PinType.ANALOG}>Analog</SelectItem>
                              <SelectItem value={PinType.PWM}>PWM</SelectItem>
                              <SelectItem value={PinType.I2C}>I2C</SelectItem>
                              <SelectItem value={PinType.SPI}>SPI</SelectItem>
                              <SelectItem value={PinType.SERIAL}>Serial</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="Description"
                            value={pin.description}
                            onChange={(e) => updatePin(index, 'description', e.target.value)}
                          />
                        </CardContent>
                      </Card>
                    ))}
                    <Button onClick={addPin} variant="outline" className="w-full">
                      <Plus size={14} />
                      Add Pin
                    </Button>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="script" className="flex-1">
                <MonacoEditor
                  height="100%"
                  language="python"
                  theme="vs-dark"
                  value={code}
                  onChange={(value) => setCode(value || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                  }}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Settings size={48} className="mx-auto mb-4 opacity-50" />
                <p>Select a component or create a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
