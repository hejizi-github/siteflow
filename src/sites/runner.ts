import type { Command } from 'commander';
import { printError, printSuccess, type OutputOptions } from '../cli/output.js';
import { runWithPageLease } from '../daemon/client.js';
import { toSiteflowError } from '../shared/errors.js';
import { writeFailureReceipt } from '../traces/artifact-store.js';
import type { SiteCommandContext } from './types.js';

interface GlobalOptions {
  json?: boolean;
  profile?: string;
}

export async function runSiteCommand(command: Command, fn: (ctx: SiteCommandContext) => Promise<unknown>): Promise<void> {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const output: OutputOptions = {
    json: Boolean(globals.json),
    profile: globals.profile || 'default',
  };
  try {
    const data = await runWithPageLease(() => fn({ profile: output.profile, output }));
    printSuccess(data, output);
  } catch (error) {
    const err = toSiteflowError(error);
    const receipt = writeFailureReceipt(output.profile, process.argv.slice(2), err);
    printError({
      code: err.code,
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
      ...(receipt ? { receipt: receipt.receiptPath } : {}),
    }, output);
    process.exitCode = 1;
  }
}
