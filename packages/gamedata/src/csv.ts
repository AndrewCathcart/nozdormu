import { parse } from "csv-parse/sync";
import { z } from "zod";

// A whole number, written as text in the CSV.
export const wholeNumber = z
  .string()
  .regex(/^-?\d+$/)
  .transform((value) => Number.parseInt(value, 10));

// A number that may have a fractional part, written as text in the CSV.
export const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .transform((value) => Number.parseFloat(value));

// Reads the rows of one of wago.tools' CSV exports, checking the columns we use and ignoring the
// rest.
export function readTable<Row extends z.ZodType>(
  name: string,
  csv: string,
  row: Row,
): z.output<Row>[] {
  const records: unknown = parse(csv, { columns: true, skip_empty_lines: true });
  const rows = z.array(row).safeParse(records);
  if (!rows.success) {
    throw new Error(`${name} didn't have the expected columns.`, { cause: rows.error });
  }
  return rows.data;
}
