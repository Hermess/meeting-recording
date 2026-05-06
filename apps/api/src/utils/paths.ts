import path from "node:path";

export function getWorkspaceRoot() {
  const cwd = process.cwd();
  return cwd.endsWith(path.join("apps", "api")) ? path.resolve(cwd, "../..") : cwd;
}

export function getStorageRoot() {
  return process.env.STORAGE_ROOT ? path.resolve(process.env.STORAGE_ROOT) : path.join(getWorkspaceRoot(), "storage");
}

export function resolveStoragePath(...segments: string[]) {
  return path.join(getStorageRoot(), ...segments);
}
