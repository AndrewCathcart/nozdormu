export interface SerializedError {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
  readonly code?: number | string;
}

// Logs only fields known to be safe. Discord's request errors also carry the request URL, which can
// hold an interaction token, and the request body, which can hold message content.
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...("status" in error && typeof error.status === "number" ? { status: error.status } : {}),
      ...("code" in error && (typeof error.code === "number" || typeof error.code === "string")
        ? { code: error.code }
        : {}),
    };
  }
  return { type: typeof error, message: "A non-error value was thrown." };
}
