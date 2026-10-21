import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { endpoints } from './endpoints';
import { GarminClient, GarminError } from './garmin';

type Parameter = {
  name: string; in: string; required?: boolean;
  schema: { type: string; format?: string; default?: unknown };
};

export function parameterSchema(parameter: Parameter): z.ZodType {
  const { name, schema } = parameter;
  let result: z.ZodType;
  if (schema.format === 'date') return z.iso.date().describe('Calendar date as YYYY-MM-DD.');
  if (schema.type === 'boolean') result = z.boolean();
  else if (schema.type === 'integer' || schema.type === 'number') {
    let number = schema.type === 'integer' ? z.number().int().safe() : z.number().finite();
    if (name === 'limit') number = number.min(1).max(100);
    else if (name === 'activityId') number = number.positive();
    else if (name === 'start' || name.startsWith('min') || name.startsWith('max') || name === 'chunks') number = number.nonnegative();
    result = number;
  } else if (schema.type === 'array') result = z.array(z.string().max(200)).max(50);
  else if (name === 'sortOrder') result = z.enum(['asc', 'desc']);
  else result = z.string().max(500);
  if (schema.default !== undefined) return result.default(schema.default);
  return parameter.required ? result : result.optional();
}

export function validateDateRange(args: Record<string, unknown>): void {
  const start = args.startDate ?? args.fromDate;
  const end = args.endDate ?? args.toDate ?? args.untilDate;
  if (typeof start !== 'string' || typeof end !== 'string') return;
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (days < 0 || days > 30) throw new Error('Use a date range in order, covering at most 31 calendar days. Split larger requests.');
}

export function endpointPath(path: string, parameters: readonly Parameter[], args: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const parameter of parameters) {
    const value = args[parameter.name];
    if (value === undefined) continue;
    if (parameter.in === 'path') path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    else if (Array.isArray(value)) for (const item of value) query.append(parameter.name, String(item));
    else query.set(parameter.name, String(value));
  }
  return path + (query.size ? `?${query}` : '');
}

export function createServer(apiKey: string, scopes: readonly string[], fetcher: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: 'garmin-personal', version: '1.0.0' }, {
    instructions: 'Read-only Garmin Connect Personal API. Data is supplied by Garmin Connect. Dates refer to Garmin calendar dates, not UTC timestamps. Use ranges of at most 31 days. Missing data is not zero. Do not infer medical diagnoses. Activity file downloads return base64, up to 2 MiB.',
  });
  const client = new GarminClient(apiKey, fetcher);
  for (const endpoint of endpoints) {
    if (endpoint.sensitive && !scopes.includes('garmin:womens-health')) continue;
    const shape: Record<string, z.ZodType> = {};
    for (const parameter of endpoint.parameters) shape[parameter.name] = parameterSchema(parameter);
    server.registerTool(endpoint.name, {
      description: `${endpoint.description} Source: Garmin Connect. Date ranges are limited to 31 days.`,
      inputSchema: z.object(shape).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (args) => {
      try {
        validateDateRange(args);
        const data = await client.get(endpointPath(endpoint.path, endpoint.parameters, args), endpoint.binary);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ source: 'Garmin Connect', data }) }] };
      } catch (error) {
        const message = error instanceof GarminError || (error instanceof Error && error.message.startsWith('Use a date range'))
          ? error.message : 'The Garmin request failed. Please try again.';
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    });
  }
  return server;
}
