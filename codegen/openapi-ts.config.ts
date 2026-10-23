import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../docs/garmin-personal-openapi.json",
  output: { path: "../src/garmin-api", postProcess: ["oxfmt"] },
  plugins: [
    {
      name: "zod",
      requests: false,
      responses: false,
      comments: false,
      dates: { local: true, offset: true },
      $resolvers: {
        number(ctx) {
          // MCP carries JSON numbers; reject precision loss instead of coercing to bigint.
          return ctx.schema.format === "int64"
            ? ctx.$(ctx.plugin.imports.z).attr("number").call().attr("int").call()
            : undefined;
        },
        object(ctx) {
          if (ctx.nodes.additionalProperties(ctx) === undefined) {
            // Preserve fields added by Garmin without weakening the documented fields.
            const properties = ctx.nodes.shape(ctx);
            ctx.nodes.base = () => ctx.$(ctx.plugin.imports.z).attr("looseObject").call(properties);
          }
        },
        unknown(ctx) {
          return ctx.$(ctx.plugin.imports.z).attr("json").call();
        },
      },
    },
  ],
});
