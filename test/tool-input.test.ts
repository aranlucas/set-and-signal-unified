import { describe, expect, it } from "vitest";
import snapshot from "../docs/garmin-personal-openapi.json";
import { endpoints } from "../src/endpoints";
import { endpointPath, parameterSchema, validateDateRange } from "../src/tool-input";
import { required } from "./support";

type PublishedParameter = {
  name: string;
  in: string;
  required?: boolean;
  schema: unknown;
};

function parameterContract(parameter: PublishedParameter) {
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.required ?? false,
    schema: parameter.schema,
  };
}

describe("Tool inputs", () => {
  it("covers the published Garmin paths and preserves their parameter contracts", () => {
    expect(endpoints).toHaveLength(Object.keys(snapshot.paths).length);
    expect(new Set(endpoints.map((endpoint) => endpoint.name)).size).toBe(endpoints.length);

    for (const [path, operation] of Object.entries(snapshot.paths)) {
      const endpoint = required(
        endpoints.find((entry) => entry.path === path),
        path,
      );

      const parameters = "parameters" in operation.get ? operation.get.parameters : [];

      expect(endpoint.parameters.map(parameterContract), path).toEqual(
        parameters.map(parameterContract),
      );
    }
  });

  it("validates calendar dates, safe activity IDs, query limits and ordered date windows", () => {
    expect(
      parameterSchema({
        name: "date",
        in: "query",
        schema: { type: "string", format: "date" },
      }).safeParse("2026-02-30").success,
    ).toBe(false);
    expect(
      parameterSchema({
        name: "activityId",
        in: "path",
        required: true,
        schema: { type: "integer" },
      }).safeParse(-1).success,
    ).toBe(false);
    expect(
      parameterSchema({ name: "limit", in: "query", schema: { type: "integer" } }).safeParse(101)
        .success,
    ).toBe(false);
    expect(() => validateDateRange({ fromDate: "2026-10-21", toDate: "2026-10-01" })).toThrow(
      "date range in order",
    );
    expect(() =>
      validateDateRange({ startDate: "2026-10-01", endDate: "2026-10-31" }),
    ).not.toThrow();
    expect(() => validateDateRange({ startDate: "2026-10-01", endDate: "2026-11-01" })).toThrow(
      "31 calendar days",
    );

    const optionalDate = parameterSchema({
      name: "startDate",
      in: "query",
      schema: { type: "string", format: "date" },
    });

    // oxlint-disable-next-line unicorn/no-useless-undefined -- checks the absent-value case; safeParse requires an argument.
    expect(optionalDate.safeParse(undefined).success).toBe(true);
    expect(
      parameterSchema({
        name: "date",
        in: "path",
        required: true,
        schema: { type: "string", format: "date" },
      }).safeParse(undefined).success, // oxlint-disable-line unicorn/no-useless-undefined -- same absent-value case.
    ).toBe(false);
    expect(
      endpointPath(
        "/x/{id}",
        [
          { name: "id", in: "path", schema: { type: "string" } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        { id: "a/b", search: "a&b" },
      ),
    ).toBe("/x/a%2Fb?search=a%26b");
  });
});
