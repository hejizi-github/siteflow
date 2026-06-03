import { SiteflowError } from '../shared/errors.js';
import type { DaemonInfo } from '../shared/types.js';
import { readDaemonInfo } from './state.js';

export async function probeDaemon(info: DaemonInfo): Promise<boolean> {
  try {
    const response = await fetch(`${info.baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function assertNoRunningDaemon(profile: string): Promise<void> {
  const info = readDaemonInfo(profile);
  if (!info) return;
  if (await probeDaemon(info)) {
    throw new SiteflowError(
      'DAEMON_ALREADY_RUNNING',
      `Daemon already running for profile "${profile}" on port ${info.port}`,
      'Run siteflow daemon status or siteflow daemon stop.',
    );
  }
}
