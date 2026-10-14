/**
 * A pipeline failure with a message that is safe and useful to show the user.
 * `retryable` distinguishes transient faults (provider 5xx, network) from
 * permanent ones (corrupt file, no audio track) so BullMQ does not burn
 * retries on errors that cannot succeed.
 */
export class PipelineError extends Error {
  constructor(
    readonly userMessage: string,
    readonly options: { retryable?: boolean; cause?: unknown; detail?: string } = {},
  ) {
    super(options.detail ?? userMessage, { cause: options.cause });
  }
  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

export const toolMissing = (tool: string) =>
  new PipelineError("Processing is temporarily unavailable. Please try again later.", {
    retryable: false,
    detail: `Required tool "${tool}" is not installed or not on PATH for the worker.`,
  });

/** Maps an HTTP status from an external provider to retryability. */
export function providerError(provider: string, status: number, body: string): PipelineError {
  const retryable = status === 408 || status === 429 || status >= 500;
  return new PipelineError(
    retryable ? `The ${provider} service is busy. We will retry automatically.` : `The ${provider} service rejected this file.`,
    { retryable, detail: `${provider} HTTP ${status}: ${body.slice(0, 500)}` },
  );
}
