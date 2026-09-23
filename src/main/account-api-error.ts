import { isDynamicRecord, isString } from "@dani-dex/contracts/runtime-values";

/** An error the account service answered with, in the vocabulary the sign-in screen speaks. */
export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }

  static async fromResponse(response: Response): Promise<AuthApiError> {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
    try {
      const value = await response.json();
      if (!isDynamicRecord(value) || !isDynamicRecord(value.error)) {
        throw new Error("Invalid error response.");
      }
      if (isString(value.error.code) && isString(value.error.message)) {
        return new AuthApiError(response.status, value.error.code, value.error.message, retryAfterSeconds);
      }
    } catch {
      // Use a generic error when the server did not return the API error shape.
    }
    return new AuthApiError(
      response.status,
      "auth_api_error",
      "The account service returned an error.",
      retryAfterSeconds,
    );
  }
}

export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? seconds : undefined;
  }
  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return undefined;
  const seconds = Math.ceil((retryAt - Date.now()) / 1_000);
  return seconds > 0 ? seconds : undefined;
}
