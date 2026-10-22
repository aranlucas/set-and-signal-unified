import { describe, expect, it } from "vitest";
import { consentFormAction } from "../src/auth";
import { consentPage } from "../src/pages";
import { required } from "./support";

const client = {
  clientId: "test",
  clientName: "Test assistant",
  redirectUri: "https://example.org",
  redirectHost: "example.org",
  redirectIsLoopback: false,
  scope: ["garmin:read"],
};

describe("Consent pages", () => {
  it("allows consent forms to redirect only to the validated client", () => {
    expect(consentFormAction("https://claude.ai/api/mcp/auth_callback?x=1")).toBe(
      "'self' https://claude.ai",
    );
    expect(consentFormAction("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(
      "'self' cursor:",
    );
  });
  it("escapes untrusted OAuth client information", () => {
    const output = consentPage(
      {
        ...client,
        clientName: "<script>alert(1)</script>",
        scope: ["<script>"],
      },
      "handle",
    );

    expect(output).not.toContain("<script>");
    expect(output).toContain("&#60;script&#62;");
  });

  it("allows Personal API keys without whitespace through browser validation", () => {
    const output = consentPage(client, "handle");

    const pattern = required(output.match(/pattern="([^"]+)"/)?.[1], "API key pattern");

    expect(pattern).toBe(String.raw`\S+`);

    const keyPattern = new RegExp(`^(?:${pattern})$`);
    expect(keyPattern.test("test-only-personal-api-key")).toBe(true);
    expect(keyPattern.test("key with spaces")).toBe(false);
  });
});
