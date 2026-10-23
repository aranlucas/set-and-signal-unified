import type { z } from "zod";

export function parseJson<Schema extends z.ZodType>(json: string, schema: Schema): z.infer<Schema> {
  // SAFETY: JSON.parse returns `any`; the provided Zod schema validates its value before return.
  return schema.parse(JSON.parse(json) as unknown);
}
