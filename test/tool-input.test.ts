import { describe, expect, it } from "vitest";
import * as z from "zod";
import snapshot from "../docs/garmin-personal-openapi.json";
import { endpoints } from "../src/endpoints";
import { endpointPath } from "../src/tool-input";
import { required } from "./support";

function tool(name: string) {
  return required(
    endpoints.find((endpoint) => endpoint.name === name),
    name,
  );
}

describe("Tool contracts", () => {
  it("covers every published path with matching parameters, defaults and required fields", () => {
    expect(endpoints).toHaveLength(Object.keys(snapshot.paths).length);
    expect(new Set(endpoints.map((endpoint) => endpoint.name)).size).toBe(endpoints.length);

    for (const [path, operation] of Object.entries(snapshot.paths)) {
      const endpoint = required(
        endpoints.find((entry) => entry.path === path),
        path,
      );

      const parameters = "parameters" in operation.get ? operation.get.parameters : [];
      const schema = z.toJSONSchema(endpoint.inputSchema, { io: "input" });
      const properties = schema.properties ?? {};

      expect(Object.keys(properties), path).toEqual(parameters.map((parameter) => parameter.name));
      expect(schema.required ?? [], path).toEqual(
        parameters
          .filter((parameter) => "required" in parameter && parameter.required)
          .map((parameter) => parameter.name),
      );
      expect(endpoint.pathParameters, path).toEqual(
        parameters
          .filter((parameter) => parameter.in === "path")
          .map((parameter) => parameter.name),
      );
      expect(schema.additionalProperties, path).toBe(false);

      for (const parameter of parameters) {
        const field = z
          .object({
            type: z.string(),
            format: z.string().optional(),
            default: z.json().optional(),
          })
          .parse(properties[parameter.name]);

        expect(field.type, `${path}: ${parameter.name}`).toBe(parameter.schema.type);

        expect(field.default, `${path}: ${parameter.name}`).toEqual(
          "default" in parameter.schema ? parameter.schema.default : undefined,
        );
        expect(field.format === "date", `${path}: ${parameter.name}`).toBe(
          "format" in parameter.schema && parameter.schema.format === "date",
        );
      }
    }
  });

  it.each([
    ["get_hrv", { calendarDate: "2026-02-30" }],
    ["get_hrv", {}],
    ["get_activity", { activityId: -1 }],
    ["get_activity", { activityId: Number.MAX_SAFE_INTEGER + 1 }],
    ["get_activity", { activityId: "123" }],
    ["get_activity", { activityId: 123, apiKey: "unexpected" }],
    ["list_activities", { limit: 0 }],
    ["list_activities", { limit: 101 }],
    ["list_activities", { favorite: 2 }],
    ["list_activities", { upperLatitude: 91 }],
    ["list_activities", { leftLongitude: -181 }],
    ["list_activities", { sortOrder: "random" }],
    ["list_activities", { startDate: "2026-10-21", endDate: "2026-10-01" }],
  ])("rejects invalid %s arguments: %j", (name, args) => {
    expect(tool(name).inputSchema.safeParse(args).success).toBe(false);
  });

  it("validates date windows at the schema boundary while retaining paged activity filters", () => {
    const steps = tool("get_steps").inputSchema;
    expect(steps.safeParse({ startDate: "2026-10-21", endDate: "2026-10-01" }).success).toBe(false);
    expect(steps.safeParse({ startDate: "2026-10-01", endDate: "2026-10-31" }).success).toBe(true);
    expect(steps.safeParse({ startDate: "2026-10-01", endDate: "2026-11-01" }).success).toBe(false);
    expect(steps.safeParse({ startDate: "2028-02-01", endDate: "2028-03-02" }).success).toBe(true);
    expect(tool("get_sleep_range").inputSchema.safeParse({}).success).toBe(true);
    expect(
      tool("list_activities").inputSchema.safeParse({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        sortOrder: "ASC",
      }).success,
    ).toBe(true);
    expect(
      tool("get_wellness_activities").inputSchema.safeParse({
        fromDate: "2026-10-01",
        untilDate: "2026-11-01",
      }).success,
    ).toBe(false);
  });

  it("encodes paths and repeated query values, including false and zero", () => {
    expect(
      endpointPath("/x/{id}", ["id"], {
        id: "a/b",
        search: "a&b",
        start: 0,
        excludeChildren: false,
        requiredField: ["heartRate", "power"],
      }),
    ).toBe(
      "/x/a%2Fb?search=a%26b&start=0&excludeChildren=false&requiredField=heartRate&requiredField=power",
    );
    expect(() => endpointPath("/x/{id}", ["id"], {})).toThrow("Missing path parameter");
  });
});
