import { daytonaApi, type SandboxFileEntry } from '@/lib/api/daytona';
import { syncSandboxToProject } from './fileHandlers';

export async function handleWorkspaceCreate({
  wsId,
  setActiveWorkspaceId,
  setIsSandboxLoading,
  setSandboxEntries,
  currentProject,
  projectFilePaths,
  loadProject,
}: {
  wsId: string;
  setActiveWorkspaceId: (id: string) => void;
  setIsSandboxLoading: (b: boolean) => void;
  setSandboxEntries: (entries: SandboxFileEntry[]) => void;
  currentProject: any;
  projectFilePaths: Set<string>;
  loadProject: (id: string) => Promise<void>;
}) {
  setActiveWorkspaceId(wsId);
  setIsSandboxLoading(true);
  try {
    const result = await daytonaApi.listFiles(wsId);
    setSandboxEntries(result.entries);
    await syncSandboxToProject({
      wsId,
      entries: result.entries,
      currentProject,
      projectFilePaths,
      loadProject,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to list sandbox files:', err);
  } finally {
    setIsSandboxLoading(false);
  }
}

export async function handleSyncComplete({
  wsId,
  setIsSandboxLoading,
  setSandboxEntries,
  currentProject,
  projectFilePaths,
  loadProject,
}: {
  wsId: string;
  setIsSandboxLoading: (b: boolean) => void;
  setSandboxEntries: (entries: SandboxFileEntry[]) => void;
  currentProject: any;
  projectFilePaths: Set<string>;
  loadProject: (id: string) => Promise<void>;
}) {
  setIsSandboxLoading(true);
  try {
    const result = await daytonaApi.listFiles(wsId);
    setSandboxEntries(result.entries);
    await syncSandboxToProject({
      wsId,
      entries: result.entries,
      currentProject,
      projectFilePaths,
      loadProject,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to refresh sandbox files after sync:', err);
  } finally {
    setIsSandboxLoading(false);
  }
}
