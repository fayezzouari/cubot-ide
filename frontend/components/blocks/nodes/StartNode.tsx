import { NodeProps, Handle, Position } from '@xyflow/react';
import { NodeDeleteButton } from './NodeDeleteButton';

export function StartNode({ data, id }: NodeProps) {
  const onDelete = data.onDelete as ((id: string) => void) | undefined;
  return (
    <div className="relative px-6 py-4 bg-[#0e0e0e] border border-blue-500/30 border-l-[3px] border-l-blue-500 text-blue-400 font-bold text-sm min-w-[140px] text-center rounded-lg transition-all">
      {onDelete && <NodeDeleteButton nodeId={id} onDelete={onDelete} />}
      <div className="flex items-center justify-center gap-2">
        <span className="text-lg">▶</span>
        <span>{data.label as string}</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-blue-500 border border-white/20"
      />
    </div>
  );
}
