type DesktopStorageInfo = {
  supported: boolean;
  dataDir: string;
  needsSetup: boolean;
};
type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: string };
interface Window {
  changyiDesktop?: {
    getStorage(): Promise<DesktopResult<DesktopStorageInfo>>;
    chooseDirectory(): Promise<DesktopResult<string | null>>;
    openStorage(): Promise<DesktopResult<void>>;
    applyStorage(request: { directory: string }): Promise<DesktopResult<{ dataDir: string }>>;
  };
}
