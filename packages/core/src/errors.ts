export interface SerializedError {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly status?: number;
  readonly code?: number | string;
  readonly cause?: SerializedError;
}

// Drizzle's failed-query errors put the query's parameter values, which can be message content,
// into the message and so into the stack. Keep the SQL, which only has placeholders. Postgres's
// data errors (SQLSTATE class 22, e.g. "invalid input syntax") repeat the value they rejected, so
// keep only their code.
function safeMessage(error: Error): string {
  if ("query" in error && typeof error.query === "string" && "params" in error) {
    return `Failed query: ${error.query}`;
  }
  if (
    "severity" in error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("22")
  ) {
    return `Postgres rejected a value (SQLSTATE ${error.code}).`;
  }
  return error.message;
}

function serialize(error: unknown, seen: WeakSet<Error>): SerializedError {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: "A non-error value was thrown." };
  }
  if (seen.has(error)) {
    return { type: error.name, message: "Circular cause omitted." };
  }
  seen.add(error);
  const message = safeMessage(error);
  return {
    type: error.name,
    message,
    // A replacer function, so "$&" and friends in the message aren't treated as patterns.
    ...(error.stack === undefined
      ? {}
      : { stack: error.stack.replace(error.message, () => message) }),
    ...("status" in error && typeof error.status === "number" ? { status: error.status } : {}),
    ...("code" in error && (typeof error.code === "number" || typeof error.code === "string")
      ? { code: error.code }
      : {}),
    ...(error.cause === undefined ? {} : { cause: serialize(error.cause, seen) }),
  };
}

// Logs only fields known to be safe. Discord's request errors also carry the request URL, which can
// hold an interaction token, and the request body, which can hold message content.
export function serializeError(error: unknown): SerializedError {
  return serialize(error, new WeakSet());
}
