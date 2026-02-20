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

/**
 * Derive the directory from a file record.
 *
 * The DB stores files in two conventions:
 *   Convention A (directory-only): path = "src",              name = "node.py"
 *   Convention B (full-path):      path = "src/node.py",      name = "node.py"
 *   Root file A:                   path = "" | "." | "/",     name = "root.py"
 *   Root file B:                   path = "root.py",          name = "root.py"
 *
 * We need to extract just the directory portion in every case.
 */
function getFileDir(filePath: string, fileName: string): string {
  const p = (filePath || '').replace(/^\/+|\/+$/g, ''); // trim slashes

  if (!p || p === '.' || p === fileName) {
    // Root-level file (either empty path, ".", or path equals the filename)
    return '';
  }

  if (p.endsWith('/' + fileName)) {
    // Convention B: path includes the filename at the end — strip it
    return p.slice(0, -(fileName.length + 1));
  }

  // Convention A: path is already a directory
  return p;
}

export function buildProjectFileTree(files: any[]): FileNode[] {
  if (!files || files.length === 0) return [];

  const tree: FileNode[] = [];
  const folders: Record<string, FileNode> = {};

  files.forEach(file => {
    const dir = getFileDir(file.path, file.name);

    if (!dir) {
      // Root-level file
      tree.push({ id: file.id, name: file.name, type: 'file' });
    } else {
      // File lives inside a folder.  We only show the top-level directory
      // (deeper nesting is flattened, matching the original behaviour).
      const topFolder = dir.split('/')[0];

      if (!folders[topFolder]) {
        folders[topFolder] = {
          id: `folder-${topFolder}`,
          name: topFolder,
          type: 'folder',
          children: [],
        };
        tree.push(folders[topFolder]);
      }
      folders[topFolder].children!.push({ id: file.id, name: file.name, type: 'file' });
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
