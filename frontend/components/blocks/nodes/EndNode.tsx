import { NodeProps, Handle, Position } from '@xyflow/react';
import { NodeDeleteButton } from './NodeDeleteButton';

export function EndNode({ data, id }: NodeProps) {
  const onDelete = data.onDelete as ((id: string) => void) | undefined;
  return (
    <div className="relative px-6 py-4 bg-[#0e0e0e] border border-white/[0.10] border-l-[3px] border-l-white/30 text-white/60 font-bold text-sm min-w-[140px] text-center rounded-lg transition-all">
      {onDelete && <NodeDeleteButton nodeId={id} onDelete={onDelete} />}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-white/30 border border-white/20"
      />
      <div className="flex items-center justify-center gap-2 mt-1">
        <span className="text-lg">⏹</span>
        <span>{data.label as string}</span>
      </div>
    </div>
  );
}
