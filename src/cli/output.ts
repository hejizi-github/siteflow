import type { ErrorEnvelope, JsonObject, SuccessEnvelope } from '../shared/types.js';

export interface OutputOptions {
  json: boolean;
  profile: string;
}

export function printSuccess<T>(data: T, opts: OutputOptions, meta: JsonObject = {}): void {
  const envelope: SuccessEnvelope<T> = {
    ok: true,
    data,
    meta: { profile: opts.profile, ...meta },
  };

  if (opts.json) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function printError(error: { code: string; message: string; hint?: string; receipt?: string }, opts: OutputOptions): void {
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.receipt ? { receipt: error.receipt } : {}),
    },
    meta: { profile: opts.profile },
  };

  if (opts.json) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  console.error(`${error.code}: ${error.message}`);
  if (error.hint) console.error(`hint: ${error.hint}`);
  if (error.receipt) console.error(`receipt: ${error.receipt}`);
}
