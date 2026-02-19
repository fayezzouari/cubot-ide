import type { FileNode } from '@/lib/mock-data';

export type SandboxFileEntry = {
  path: string;
  type: 'file' | 'dir';
};

export function buildSandboxFileTree(sandboxEntries: SandboxFileEntry[]): FileNode[] {
  if (sandboxEntries.length === 0) return [];
  const tree: FileNode[] = [];
  const folderMap: Record<string, FileNode> = {};
  const sorted = [...sandboxEntries].sort((a, b) => a.path.localeCompare(b.path));
  sorted.filter(e => e.type === 'dir').forEach(entry => {
    const parts = entry.path.split('/');
    const name = parts[parts.length - 1];
    folderMap[entry.path] = { id: `sandbox-folder:${entry.path}`, name, type: 'folder', children: [] };
  });
  sorted.forEach(entry => {
    const parts = entry.path.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const name = parts[parts.length - 1];
    const node: FileNode = entry.type === 'dir'
      ? folderMap[entry.path]
      : { id: `sandbox:${entry.path}`, name, type: 'file' };
    if (!parentPath) {
      tree.push(node);
    } else {
      const parent = folderMap[parentPath];
      if (parent) {
        parent.children!.push(node);
      } else {
        tree.push(node);
      }
    }
  });
  return tree;
}

export function buildProjectFileTree(files: any[]): FileNode[] {
  if (!files || files.length === 0) return [];
  const tree: FileNode[] = [];
  const folders: Record<string, FileNode> = {};
  files.forEach(file => {
    const pathParts = file.path.split('/');
    if (pathParts.length === 1) {
      tree.push({ id: file.id, name: file.name, type: 'file' });
    } else {
      const folderName = pathParts[0];
      if (!folders[folderName]) {
        folders[folderName] = {
          id: `folder-${folderName}`,
          name: folderName,
          type: 'folder',
          children: [],
        };
        tree.push(folders[folderName]);
      }
      folders[folderName].children!.push({ id: file.id, name: file.name, type: 'file' });
    }
  });
  return tree;
}

export function buildUnifiedFileTree(
  activeWorkspaceId: string | null,
  sandboxFileTree: FileNode[],
  sandboxToProjectMap: Map<string, string>
): FileNode[] {
  if (!activeWorkspaceId || sandboxFileTree.length === 0) return [];
  const mapNode = (node: any): any => {
    if (node.type === 'folder') {
      return { ...node, children: node.children?.map(mapNode) };
    }
    const relPath = (node.id as string).replace(/^sandbox:/, '');
    const projectId = sandboxToProjectMap.get(relPath);
    return projectId
      ? { ...node, id: projectId, source: 'ide' }
      : { ...node, source: 'sandbox' };
  };
  return sandboxFileTree.map(mapNode);
}
