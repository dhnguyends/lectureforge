export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized", "Sign in to continue.");

// Missing and forbidden resources both return 404 so that IDs of other users'
// study sets cannot be probed.
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`);

export const forbidden = (message = "You do not have permission to do that.") =>
  new HttpError(403, "forbidden", message);

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);

export const conflict = (message: string) => new HttpError(409, "conflict", message);

export const tooManyRequests = (retryAfterSeconds: number) =>
  new HttpError(429, "rate_limited", "Too many requests. Please wait and try again.", {
    retryAfterSeconds,
  });

/** An error whose message is safe to show to the user (e.g. on a failed source). */
export class UserFacingError extends Error {}
