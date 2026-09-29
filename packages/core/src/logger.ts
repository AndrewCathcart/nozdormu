import { type Logger, pino } from "pino";
import { serializeError } from "./errors.ts";

// JSON lines with ISO timestamps. Errors logged under `err` go through serializeError.
export function createLogger(): Logger {
  return pino({
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: serializeError },
  });
}
