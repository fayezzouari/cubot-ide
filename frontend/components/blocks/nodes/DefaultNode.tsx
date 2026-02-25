import { NodeProps, Handle, Position } from '@xyflow/react';
import { NodeDeleteButton } from './NodeDeleteButton';

export function DefaultNode({ data, id }: NodeProps) {
  const onDelete = data.onDelete as ((id: string) => void) | undefined;
  return (
    <div className="relative px-6 py-3 bg-[#0e0e0e] border border-white/[0.10] text-white/60 font-bold text-sm min-w-[120px] text-center rounded-lg">
      {onDelete && <NodeDeleteButton nodeId={id} onDelete={onDelete} />}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-white/30 border border-white/20"
      />
      <div>{data.label as string}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-white/30 border border-white/20"
      />
    </div>
  );
}
