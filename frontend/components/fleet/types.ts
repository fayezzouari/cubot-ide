import type { Drone, Environment, Robot, Task } from '@/lib/fleet/types';

export interface EnvironmentViewProps {
  environment: Environment;
  robots: Robot[];
  drones?: Drone[];
  tasks: Task[];
  paths?: Record<string, { x: number; y: number }[]>;
  taskColors?: Record<string, string>;
  selectedRobotId?: string | null;
  selectedDroneId?: string | null;
  onPick?: (cell: { x: number; y: number }) => void;
  onRobotSelect?: (id: string | null) => void;
  onRobotMove?: (id: string, cell: { x: number; y: number }) => void;
  onDroneSelect?: (id: string | null) => void;
}
