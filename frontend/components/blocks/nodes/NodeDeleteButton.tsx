import { X } from 'lucide-react';

interface NodeDeleteButtonProps {
  nodeId: string;
  onDelete: (nodeId: string) => void;
}

export function NodeDeleteButton({ nodeId, onDelete }: NodeDeleteButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete(nodeId);
      }}
      className="absolute -top-2 -right-2 w-5 h-5 bg-[#0a0a0a] border border-white/[0.10] hover:border-red-500/50 text-white/20 hover:text-red-400 rounded-full flex items-center justify-center transition-all z-10"
      title="Delete block"
    >
      <X size={12} />
    </button>
  );
}
