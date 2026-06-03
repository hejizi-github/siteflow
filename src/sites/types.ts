import type { OutputOptions } from '../cli/output.js';

export interface SiteCommandContext {
  profile: string;
  output: OutputOptions;
}

export interface SiteCommandSpec {
  name: string;
  description: string;
  configure(command: import('commander').Command): void;
}

export interface SiteAdapter {
  id: string;
  title: string;
  description: string;
  commands: SiteCommandSpec[];
}

export interface SiteReceipt {
  site: string;
  command: string;
  ok: boolean;
  state: string;
  page?: {
    url: string;
    title: string;
  };
  screenshots?: string[];
  observations?: Record<string, unknown>;
  errors?: Array<{
    code: string;
    message: string;
  }>;
  next?: string[];
}
