import { NodeProps, Handle, Position } from '@xyflow/react';
import { NodeDeleteButton } from './NodeDeleteButton';

export function MovePositionNode({ data, id }: NodeProps) {
  const onDelete = data.onDelete as ((id: string) => void) | undefined;
  return (
    <div className="relative bg-[#0e0e0e] border border-white/[0.10] border-l-[3px] border-l-violet-400 text-white/60 min-w-[180px] rounded-lg">
      {onDelete && <NodeDeleteButton nodeId={id} onDelete={onDelete} />}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 bg-violet-400 border border-white/20"
      />
      <div className="px-4 py-2 border-b border-white/[0.06] font-bold text-sm text-white/80">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-6">X:</span>
          <input
            type="number"
            defaultValue={0}
            step="0.01"
            min="-5"
            max="5"
            className="flex-1 px-1 py-0.5 bg-white/[0.04] border border-white/[0.08] text-foreground text-center focus:outline-none focus:border-white/20"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6">Y:</span>
          <input
            type="number"
            defaultValue={0}
            step="0.01"
            min="-5"
            max="5"
            className="flex-1 px-1 py-0.5 bg-white/[0.04] border border-white/[0.08] text-foreground text-center focus:outline-none focus:border-white/20"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6">Z:</span>
          <input
            type="number"
            defaultValue={0}
            step="0.01"
            min="-5"
            max="5"
            className="flex-1 px-1 py-0.5 bg-white/[0.04] border border-white/[0.08] text-foreground text-center focus:outline-none focus:border-white/20"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="text-[9px] text-white/40 mt-1">
          Uses IK to move arm
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 bg-violet-400 border border-white/20"
      />
    </div>
  );
}
