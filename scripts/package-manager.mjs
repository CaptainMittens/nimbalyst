/**
 * The one place repo tooling names its package manager. Gate stages, the
 * workspace script runner, and hooks spawn pnpm through here, and read the
 * workspace layout from pnpm-workspace.yaml rather than re-deriving it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export const packageManager = 'pnpm';

/** Windows package-manager shims are .cmd files, which Node must launch through cmd.exe. */
export function shimSpawnConfig(tool, platform = process.platform, env = process.env) {
  return platform === 'win32'
    ? { command: env.ComSpec || 'cmd.exe', argsPrefix: ['/d', '/s', '/c', `${tool}.cmd`] }
    : { command: tool, argsPrefix: [] };
}

export function packageManagerSpawnConfig(platform = process.platform, env = process.env) {
  return shimSpawnConfig(packageManager, platform, env);
}

/** Parsed pnpm-workspace.yaml (packages, overrides, allowBuilds, ...). */
export function readWorkspaceConfig(rootDir) {
  return parse(readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8')) ?? {};
}
