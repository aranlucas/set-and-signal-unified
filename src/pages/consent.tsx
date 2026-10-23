import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { ConsentLayout } from "./layout";
import { garminKeyUrl } from "./links";

type ConsentPageProps = { details: ConsentDescription; handle: string };

export function ConsentPage({ details, handle }: ConsentPageProps) {
  return (
    <ConsentLayout title="Authorize access">
      <h1>Connect {details.clientName}.</h1>
      <p>
        {details.clientDomain ? (
          <>
            Published by <strong>{details.clientDomain}</strong>.
          </>
        ) : (
          "This client’s name is self-reported."
        )}{" "}
        Access will return to <strong>{details.redirectHost}</strong>.
      </p>
      {details.redirectIsLoopback && (
        <p class="notice">
          This sends access to an app on your computer. Continue only if you started this
          connection.
        </p>
      )}
      <p>
        Allow this assistant to read your Garmin activity and health data. Your Garmin key stays on
        this server, encrypted in the authorization grant.
      </p>
      <form method="post" action="/authorize">
        <input type="hidden" name="handle" value={handle} />
        <p>
          <strong>Requested permissions</strong>
        </p>
        <ul>
          {details.scope.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
        <label for="apiKey">Garmin Personal API key</label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autocomplete="off"
          required
          minlength={8}
          maxlength={4096}
          pattern={String.raw`\S+`}
        />
        <p class="muted">
          <a href={garminKeyUrl} target="_blank" rel="noopener noreferrer">
            Create a key in Garmin Connect
          </a>
          , then paste it here. This is your personal API key, not your Garmin password or a 24-hour
          access token.
        </p>
        <label>
          <input type="checkbox" name="womensHealth" value="yes" />
          Also allow women’s health data
        </label>
        <p class="muted">Optional: adds menstrual cycle summary and day-view tools.</p>
        <p>
          <button name="decision" value="approve">
            Connect and allow
          </button>
          <button class="secondary" name="decision" value="deny" formnovalidate>
            Deny
          </button>
        </p>
      </form>
      <p>
        <a href="/privacy">How to disconnect and delete access</a>
      </p>
    </ConsentLayout>
  );
}
