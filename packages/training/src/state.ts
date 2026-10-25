import * as validation from "valibot";

// Keep the export shape at the boundary; store growing histories as separate documents.
export type RecordValue = { key: string; value: string };

const collections = new Set(["workouts", "routines", "customEx"]);

// eslint-disable-next-line anti-slop/no-unknown-parameters -- Persistence codec preserves arbitrary forward-compatible values; recursive canonicalization and the mutation encoding check form this boundary.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  // eslint-disable-next-line anti-slop/no-runtime-typeof -- A serializer must distinguish objects without parsing/cloning them or reading getters twice; preserve the established canonical byte encoding.
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

// eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Forward-compatible persisted fields must survive round trips; collection IDs are checked here and consumers validate concrete fields.
export function splitState(state: Record<string, unknown>): RecordValue[] {
  const records: RecordValue[] = [];

  for (const [field, value] of Object.entries(state)) {
    if (field === "active" || field === "_ts") continue;

    if (collections.has(field) && Array.isArray(value)) {
      const ids = new Set<string>();

      for (const item of value) {
        const identified = validation.safeParse(
          validation.object({ id: validation.string() }),
          item,
        );

        if (!identified.success || ids.has(identified.output.id))
          throw new Error(`Invalid or duplicate ${field} id`);
        const id = identified.output.id;
        ids.add(id);
        records.push({ key: `${field}/${id}`, value: canonical(item) });
      }

      records.push({ key: `order/${field}`, value: canonical([...ids]) });
    } else records.push({ key: `field/${field}`, value: canonical(value) });
  }

  return records;
}

export function joinState(records: RecordValue[], revision: number) {
  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This accumulator deliberately preserves heterogeneous persisted values without asserting a fabricated domain type.
  const state: Record<string, unknown> = {};
  state._ts = revision;

  const values = new Map(
    records.map((record) => [
      record.key,
      validation.parse(validation.unknown(), JSON.parse(record.value)),
    ]),
  );

  for (const [key, value] of values) {
    if (key.startsWith("field/"))
      Object.defineProperty(state, key.slice(6), { value, enumerable: true, writable: true });

    if (key.startsWith("order/")) {
      const field = key.slice(6);
      Object.defineProperty(state, field, {
        value: validation
          .parse(validation.array(validation.unknown()), value)
          .map((id) => values.get(`${field}/${String(id)}`))
          .filter((item) => item !== undefined),
        enumerable: true,
        writable: true,
      });
    }
  }

  return state;
}
