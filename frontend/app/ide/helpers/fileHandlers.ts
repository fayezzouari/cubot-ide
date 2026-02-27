import { daytonaApi, type SandboxFileEntry } from '@/lib/api/daytona';
import { fileService } from '@/lib/api';
import type { FileNode } from '@/lib/mock-data';

const FILE_TYPE_MAP: Record<string, string> = {
  c: 'c', cpp: 'cpp', h: 'h', hpp: 'hpp', ino: 'ino',
  py: 'py', txt: 'txt', md: 'md', json: 'json',
  xml: 'other', cfg: 'other', toml: 'other',
};

export async function importSandboxFile({
  wsId,
  entry,
  currentProject,
  createFile,
  setSelectedFile,
  setEditedContent,
  setFileContents,
}: {
  wsId: string;
  entry: SandboxFileEntry;
  currentProject: any;
  createFile: any;
  setSelectedFile: (id: string) => void;
  setEditedContent: (content: string) => void;
  setFileContents: (cb: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const { content } = await daytonaApi.getFileContent(wsId, entry.path);
  const parts = entry.path.split('/');
  const fileName = parts[parts.length - 1];
  const filePath = parts.slice(0, -1).join('/') || '/';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const fileType = FILE_TYPE_MAP[ext] || 'other';
  if (currentProject && Array.isArray(currentProject.files)) {
    const relPath = entry.path; // sandbox relative path like 'src/foo/bar.c'
    const existing = currentProject.files.find((f: any) => {
      const dir = f.path && f.path !== '/' && f.path !== '.'
        ? f.path.replace(/^\//, '').replace(/\/$/, '') + '/'
        : '';
      return (dir + f.name) === relPath;
    });
    if (existing) {
      setSelectedFile(existing.id);
      setEditedContent(existing.content);
      setFileContents(prev => ({ ...prev, [existing.id]: existing.content }));
      return;
    }
  }

  const newFile = await createFile(fileName, filePath, content, fileType, 'daytona');
  setSelectedFile(newFile.id);
  setEditedContent(content);
  setFileContents(prev => ({ ...prev, [newFile.id]: content }));
}

export async function syncSandboxToProject({
  wsId,
  entries,
  currentProject,
  projectFilePaths,
  loadProject,
}: {
  wsId: string;
  entries: SandboxFileEntry[];
  currentProject: any;
  projectFilePaths: Set<string>;
  loadProject: (id: string) => Promise<void>;
}) {
  if (!currentProject) return;
  const srcFiles = entries.filter(e => e.type === 'file' && e.path.startsWith('src/'));
  const missing = srcFiles.filter(e => !projectFilePaths.has(e.path));
  if (missing.length === 0) return;
  let imported = 0;
  for (const entry of missing) {
    try {
      const { content } = await daytonaApi.getFileContent(wsId, entry.path);
      const parts = entry.path.split('/');
      const fileName = parts[parts.length - 1];
      const filePath = parts.slice(0, -1).join('/');
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      await fileService.create({
        project_id: currentProject.id,
        name: fileName,
        path: filePath,
        content,
        file_type: (FILE_TYPE_MAP[ext] ?? 'other') as any,
        origin: 'daytona',
      });
      imported++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[sync] failed to import ${entry.path}:`, err);
    }
  }
  if (imported > 0) {
    await loadProject(currentProject.id);
  }
}
