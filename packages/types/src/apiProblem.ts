/** RFC 9457 Problem Details with stable SaveCloud extensions. */
export interface ApiProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  /** Stable machine-readable SaveCloud error code; consumers must not parse `detail`. */
  code: string;
  requestId: string;
  /** @deprecated Kept for compatibility with older desktop clients. */
  error: string;
  /** @deprecated Kept for compatibility with older desktop clients. */
  message: string;
  /** @deprecated Kept for compatibility with older desktop clients. */
  statusCode: number;
}
