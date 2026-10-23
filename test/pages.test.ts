import { describe, expect, it } from "vitest";
import { consentFormAction } from "../src/auth";
import { authorizationErrorPage, consentPage, home } from "../src/pages";
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
    expect(output).toContain("&lt;script&gt;");
  });

  it("escapes every consent value in text and attribute contexts", () => {
    const untrusted = '"><script>alert("test")</script>&';

    const output = consentPage(
      {
        ...client,
        clientName: untrusted,
        clientDomain: untrusted,
        redirectHost: untrusted,
        scope: [untrusted],
      },
      untrusted,
    );

    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;&amp;");
    expect(output).toContain(
      'name="handle" value="&quot;&gt;&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;&amp;"',
    );
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

describe("Page rendering", () => {
  it("keeps configured server URLs inside the read-only input value", () => {
    const output = home('https://example.org/" autofocus onfocus="alert(1)');

    expect(output).toContain(
      'value="https://example.org/&quot; autofocus onfocus=&quot;alert(1)/mcp"',
    );
    expect(output).not.toContain(' autofocus onfocus="alert(1)');
  });

  it("renders authorization error messages as escaped text", () => {
    const output = authorizationErrorPage('<img src=x onerror="alert(1)">');

    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
