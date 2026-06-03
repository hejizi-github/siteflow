import { browserProfileDir, ensureProfileDirs, profileDir } from '../shared/paths.js';

export interface ProfilePaths {
  profileDir: string;
  browserProfileDir: string;
}

export function resolveProfile(profile: string): ProfilePaths {
  ensureProfileDirs(profile);
  return {
    profileDir: profileDir(profile),
    browserProfileDir: browserProfileDir(profile),
  };
}
