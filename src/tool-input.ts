import * as z from "zod";
import type { Parameter } from "./endpoints";
import { GarminError } from "./garmin-error";

/** Values the parameter schemas below accept. */
export type ToolArgument = string | number | boolean | string[];

export type ToolArguments = Readonly<Record<string, ToolArgument | undefined>>;

export type ToolArgumentSchema = z.ZodType<ToolArgument | undefined>;

const optionalDate = z.iso.date().optional();

export const MAX_RANGE_DAYS = 31;

export function parameterSchema(parameter: Parameter): ToolArgumentSchema {
  const { name, schema } = parameter;
  let result: z.ZodType<ToolArgument>;

  if (schema.format === "date") {
    result = z.iso.date();
  } else if (schema.type === "boolean") {
    result = z.boolean();
  } else if (schema.type === "integer" || schema.type === "number") {
    let number = schema.type === "integer" ? z.number().int().safe() : z.number().finite();

    if (name === "limit") {
      number = number.min(1).max(100);
    } else if (name === "activityId") {
      number = number.positive();
    } else if (
      name === "start" ||
      name.startsWith("min") ||
      name.startsWith("max") ||
      name === "chunks"
    ) {
      number = number.nonnegative();
    }

    result = number;
  } else if (schema.type === "array") {
    result = z.array(z.string().max(200)).max(50);
  } else if (name === "sortOrder") {
    result = z.enum(["asc", "desc"]);
  } else {
    result = z.string().max(500);
  }

  const description =
    schema.format === "date"
      ? [parameter.description, "Calendar date as YYYY-MM-DD."].filter(Boolean).join(" ")
      : parameter.description;

  if (description) {
    result = result.describe(description);
  }

  if (schema.default !== undefined) {
    return result.default(schema.default);
  }

  return parameter.required ? result : result.optional();
}

export function validateDateRange(args: ToolArguments): void {
  const start = optionalDate.parse(args.startDate ?? args.fromDate);
  const end = optionalDate.parse(args.endDate ?? args.toDate ?? args.untilDate);

  if (start === undefined || end === undefined) {
    return;
  }

  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;

  if (days < 0 || days >= MAX_RANGE_DAYS) {
    throw new GarminError(
      `Use a date range in order, covering at most ${MAX_RANGE_DAYS} calendar days. Split larger requests.`,
      400,
    );
  }
}

export function endpointPath(
  path: string,
  parameters: readonly Parameter[],
  args: ToolArguments,
): string {
  const query = new URLSearchParams();

  for (const parameter of parameters) {
    const value = args[parameter.name];

    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(parameter.name, item);
      }
    } else if (parameter.in === "path") {
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    } else {
      query.set(parameter.name, String(value));
    }
  }

  return path + (query.size ? `?${query}` : "");
}
