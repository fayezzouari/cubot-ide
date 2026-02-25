import { NodeProps, Handle, Position } from '@xyflow/react';
import { NodeDeleteButton } from './NodeDeleteButton';

export function MoveJointNode({ data, id }: NodeProps) {
  const onDelete = data.onDelete as ((id: string) => void) | undefined;
  const onDataChange = data.onDataChange as ((id: string, updates: Record<string, any>) => void) | undefined;

  const joint = (data.joint as number) ?? 1;
  const angle = (data.angle as number) ?? 0;

  return (
    <div className="relative bg-[#0e0e0e] border border-white/[0.10] border-l-[3px] border-l-violet-400 text-white/60 min-w-[180px] rounded-lg">
      {onDelete && <NodeDeleteButton nodeId={id} onDelete={onDelete} />}
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-violet-400 border border-white/20" />
      <div className="px-4 py-2 border-b border-white/[0.06] font-bold text-sm text-white/80">
        {data.label as string}
      </div>
      <div className="px-4 py-2 text-xs font-medium space-y-1.5">
        <div className="flex items-center gap-2">
          <span>JOINT:</span>
          <select
            value={joint}
            className="flex-1 px-1 py-0.5 bg-white/[0.04] border border-white/[0.08] text-foreground focus:outline-none focus:border-white/20"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onDataChange?.(id, { joint: parseInt(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((j) => (
              <option key={j} value={j}>Joint {j}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span>ANGLE:</span>
          <input
            type="number"
            value={angle}
            step="1"
            min="-180"
            max="180"
            className="flex-1 px-1 py-0.5 bg-white/[0.04] border border-white/[0.08] text-foreground text-center focus:outline-none focus:border-white/20"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onDataChange?.(id, { angle: parseFloat(e.target.value) || 0 })}
          />
          <span className="text-[10px]">°</span>
        </div>
        <div className="text-[9px] text-white/40 mt-1">Range: -180° to +180°</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-violet-400 border border-white/20" />
    </div>
  );
}
