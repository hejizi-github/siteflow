import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function siteflowHome(): string {
  return process.env.SITEFLOW_HOME || path.join(os.homedir(), '.siteflow');
}

export function profileDir(profile: string): string {
  return path.join(siteflowHome(), 'profiles', profile);
}

export function daemonInfoPath(profile: string): string {
  return path.join(profileDir(profile), 'daemon.json');
}

export function browserProfileDir(profile: string): string {
  return path.join(profileDir(profile), 'browser-profile');
}

export function ensureProfileDirs(profile: string): void {
  fs.mkdirSync(profileDir(profile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(browserProfileDir(profile), { recursive: true, mode: 0o700 });
}
