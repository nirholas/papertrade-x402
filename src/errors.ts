/** A request the caller can fix. Returned as 400 before any payment is requested. */
export class InputError extends Error {
  readonly status = 400;
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'InputError';
  }
}

/** The Papertrade API (or Hyperliquid candle source) did not give us what we need. Returned as 502, so nothing is settled. */
export class UpstreamError extends Error {
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}
