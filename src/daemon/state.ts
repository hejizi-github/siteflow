import * as fs from 'node:fs';
import { daemonInfoPath, ensureProfileDirs } from '../shared/paths.js';
import type { DaemonInfo } from '../shared/types.js';

export function readDaemonInfo(profile: string): DaemonInfo | null {
  try {
    const raw = fs.readFileSync(daemonInfoPath(profile), 'utf-8');
    return JSON.parse(raw) as DaemonInfo;
  } catch {
    return null;
  }
}

export function writeDaemonInfo(info: DaemonInfo): void {
  ensureProfileDirs(info.profile);
  fs.writeFileSync(daemonInfoPath(info.profile), JSON.stringify(info, null, 2), { mode: 0o600 });
}

export function clearDaemonInfo(profile: string): void {
  try {
    fs.unlinkSync(daemonInfoPath(profile));
  } catch {
    // already gone
  }
}
