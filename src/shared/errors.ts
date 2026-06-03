export class SiteflowError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'SiteflowError';
  }
}

export function toSiteflowError(error: unknown): SiteflowError {
  if (error instanceof SiteflowError) return error;
  if (error instanceof Error) return new SiteflowError('UNKNOWN', error.message);
  return new SiteflowError('UNKNOWN', String(error));
}
