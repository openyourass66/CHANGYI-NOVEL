type DesktopStorageInfo = {
  supported: boolean;
  dataDir: string;
  needsSetup: boolean;
  sources: Array<{ directory: string; projectCount: number; chapterCount: number; profileCount: number }>;
};
type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: string };
interface Window {
  changyiDesktop?: {
    getStorage(): Promise<DesktopResult<DesktopStorageInfo>>;
    chooseDirectory(purpose: "source" | "destination"): Promise<DesktopResult<string | null>>;
    openStorage(): Promise<DesktopResult<void>>;
    applyStorage(request: { directory: string; action: "open" | "move" | "import"; sourceDirectory?: string }): Promise<DesktopResult<{ dataDir: string }>>;
  };
}
