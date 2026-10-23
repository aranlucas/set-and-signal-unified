import { app } from "./app";

export { GarminUserData } from "./push/store";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await app.fetch(request, env, ctx);
    } catch {
      // No URLs: the Garmin delivery route contains a private credential.
      // oxlint-disable-next-line no-console -- Workers Logs receives only this fixed event name.
      console.error(JSON.stringify({ event: "request_failed" }));

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
