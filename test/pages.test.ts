import { describe, expect, it } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { consentFormAction } from "../src/page-headers";
import { ConsentPage } from "../src/pages/consent";
import { AuthorizationErrorPage } from "../src/pages/errors";
import { HomePage } from "../src/pages/home";
import { TrainingConsentPage } from "../src/pages/training";
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
    const output = renderToString(
      ConsentPage({
        details: {
          ...client,
          clientName: "<script>alert(1)</script>",
          scope: ["<script>"],
        },
        handle: "handle",
      }),
    );

    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
  });

  it("escapes every consent value in text and attribute contexts", () => {
    const untrusted = '"><script>alert("test")</script>&';

    const output = renderToString(
      ConsentPage({
        details: {
          ...client,
          clientName: untrusted,
          clientDomain: untrusted,
          redirectHost: untrusted,
          scope: [untrusted],
        },
        handle: untrusted,
      }),
    );

    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;&amp;");
    expect(output).toContain(
      'name="handle" value="&quot;&gt;&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;&amp;"',
    );
  });

  it("allows Personal API keys without whitespace through browser validation", () => {
    const output = renderToString(ConsentPage({ details: client, handle: "handle" }));

    const pattern = required(output.match(/pattern="([^"]+)"/)?.[1], "API key pattern");

    expect(pattern).toBe(String.raw`\S+`);

    const keyPattern = new RegExp(`^(?:${pattern})$`);
    expect(keyPattern.test("test-only-personal-api-key")).toBe(true);
    expect(keyPattern.test("key with spaces")).toBe(false);
  });
});

describe("Page rendering", () => {
  it("escapes Training consent values in both text and attributes", () => {
    const untrusted = '"><script>alert("test")</script>&';

    const output = renderToString(
      TrainingConsentPage({
        details: {
          ...client,
          clientName: untrusted,
          clientDomain: untrusted,
          redirectHost: untrusted,
          scope: [untrusted],
        },
        handle: untrusted,
      }),
    );

    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
    expect(output).toContain('name="handle" value="&quot;&gt;&lt;script&gt;');
    expect(output).toContain('action="/training/authorize"');
  });

  it("keeps configured server URLs inside the read-only input value", () => {
    const output = renderToString(
      HomePage({ publicUrl: 'https://example.org/" autofocus onfocus="alert(1)' }),
    );

    expect(output).toContain(
      'value="https://example.org/&quot; autofocus onfocus=&quot;alert(1)/mcp"',
    );
    expect(output).not.toContain(' autofocus onfocus="alert(1)');
  });

  it("renders authorization error messages as escaped text", () => {
    const output = renderToString(
      AuthorizationErrorPage({ message: '<img src=x onerror="alert(1)">' }),
    );

    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
