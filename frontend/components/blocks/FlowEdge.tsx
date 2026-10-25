'use client';

import { memo, useContext, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { BlocksCanvasContext } from './FlowNode';

function FlowEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected, interactionWidth }: EdgeProps) {
  const { running } = useContext(BlocksCanvasContext);
  const { deleteElements } = useReactFlow();
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 16 });
  const show = !running && (hover || selected);

  return (
    <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 24}
        style={selected ? { ...style, strokeWidth: 2.75, filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.35))' } : style}
      />
      {show && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-[#141416] text-white/70 shadow hover:border-red-400/60 hover:bg-red-500/20 hover:text-red-200"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            title="Delete link (or select it and press Delete)"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
          >
            <X size={11} />
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
