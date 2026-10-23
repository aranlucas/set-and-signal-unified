import * as z from "zod";
import { GarminError } from "./garmin-error";

export type ToolArgument = string | number | boolean | string[];

export type ToolArguments = Readonly<Record<string, ToolArgument | undefined>>;

export const MAX_RANGE_DAYS = 31;

export const DATE_RANGE_MESSAGE = `Use a date range in order, covering at most ${MAX_RANGE_DAYS} calendar days. Split larger requests.`;

export const calendarDate = z.iso.date().describe("Calendar date as YYYY-MM-DD.");

export const activityId = z.number().int().positive().describe("Garmin activity ID.");

export function isOrderedDateRange(start: string | undefined, end: string | undefined): boolean {
  return start === undefined || end === undefined || start <= end;
}

export function isBoundedDateRange(start: string | undefined, end: string | undefined): boolean {
  if (start === undefined || end === undefined) {
    return true;
  }

  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;

  return days >= 0 && days < MAX_RANGE_DAYS;
}

/** Only catalogued path parameters are interpolated; all other inputs become query parameters. */
export function endpointPath(
  path: string,
  pathParameters: readonly string[],
  args: ToolArguments,
): string {
  for (const name of pathParameters) {
    const value = args[name];

    if (value === undefined || Array.isArray(value)) {
      throw new GarminError(`Missing path parameter: ${name}.`, 400);
    }

    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }

  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(args)) {
    if (value === undefined || pathParameters.includes(name)) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(name, String(item));
    }
  }

  return path + (query.size ? `?${query}` : "");
}
