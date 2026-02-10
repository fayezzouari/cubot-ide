/**
 * API client for custom components (sensors/actuators)
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export enum ComponentType {
  SENSOR = 'sensor',
  ACTUATOR = 'actuator',
}

export enum PinType {
  DIGITAL = 'digital',
  ANALOG = 'analog',
  PWM = 'pwm',
  I2C = 'i2c',
  SPI = 'spi',
  SERIAL = 'serial',
}

export interface PinDefinition {
  name: string;
  pin_type: PinType;
  description?: string;
  default_value?: any;
}

export interface ComponentScript {
  language: string;
  code: string;
  entry_point: string;
}

export interface Component {
  id?: string;
  user_id?: string;
  name: string;
  component_type: ComponentType;
  description?: string;
  pins: PinDefinition[];
  script: ComponentScript;
  icon?: string;
  properties: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface SimulationComponentInstance {
  instance_id: string;
  component_id: string;
  position: { x: number; y: number };
  rotation: number;
  pin_connections: Record<string, string>;
  state: Record<string, any>;
}

export interface SimulationConfig {
  arduino_code: string;
  components: SimulationComponentInstance[];
  wiring: Array<Record<string, string>>;
  duration?: number;
}

export const componentsApi = {
  async createComponent(component: Omit<Component, 'id' | 'created_at' | 'updated_at'>): Promise<Component> {
    const response = await fetch(`${API_BASE}/components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(component),
    });
    if (!response.ok) throw new Error('Failed to create component');
    return response.json();
  },

  async getComponents(componentType?: ComponentType): Promise<Component[]> {
    const params = new URLSearchParams();
    if (componentType) params.append('component_type', componentType);
    
    const response = await fetch(`${API_BASE}/components?${params}`);
    if (!response.ok) throw new Error('Failed to fetch components');
    return response.json();
  },

  async getComponent(id: string): Promise<Component> {
    const response = await fetch(`${API_BASE}/components/${id}`);
    if (!response.ok) throw new Error('Failed to fetch component');
    return response.json();
  },

  async updateComponent(id: string, updates: Partial<Component>): Promise<Component> {
    const response = await fetch(`${API_BASE}/components/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update component');
    return response.json();
  },

  async deleteComponent(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/components/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete component');
  },
};
