import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { TrainingLayout } from "./layout";

type TrainingHomeProps = { resource: string };

type TrainingConsentProps = { details: ConsentDescription; handle: string };

export function TrainingHomePage({ resource }: TrainingHomeProps) {
  return (
    <TrainingLayout title="Connect your Garmin training">
      <h1>
        Send your workouts
        <br />
        to Garmin.
      </h1>
      <p>
        Connect an MCP-compatible assistant to create workouts and schedule them for sync to your
        Garmin watch.
      </p>
      <div class="notice">
        <strong>Training MCP server URL</strong>
        <br />
        <code>{resource}</code>
      </div>
      <ol>
        <li>Add this server URL to your assistant and choose OAuth authentication.</li>
        <li>Review the assistant’s permissions, then continue to Garmin.</li>
        <li>Sign in to Garmin and allow Workout Import access.</li>
      </ol>
      <p>
        Workout sending uses the Garmin Business Training API. The service operator must have an
        approved Garmin developer application. Your Garmin Personal API key does not enable workout
        sending.
      </p>
      <p>
        <a href="/training/privacy">Storage and revocation</a>
      </p>
    </TrainingLayout>
  );
}

export function TrainingPrivacyPage() {
  return (
    <TrainingLayout title="Storage and revocation">
      <h1>You control training access.</h1>
      <p>
        The server stores OAuth clients, consent transactions and authorization grants in Cloudflare
        KV. Garmin access and refresh tokens are encrypted by the OAuth provider library inside each
        grant. MCP tools never return these credentials.
      </p>
      <p>
        Your assistant can create workouts and schedule them for sync to your Garmin watch. Workout
        responses are handled for the current request; the server does not store workout history.
      </p>
      <p>
        MCP access tokens last at most one hour and expire before the Garmin access token. Refresh
        access ends within 30 days of an exchange and never lasts beyond the Garmin refresh token’s
        expiry.
      </p>
      <p>
        Remove this service from Garmin Connect’s Connected Apps to revoke the Garmin authorization.
        Revoking a local MCP token or grant only removes your assistant’s local access; it does not
        disconnect the app at Garmin.
      </p>
      <p>
        <a href="/training">Training setup</a>
      </p>
    </TrainingLayout>
  );
}

export function TrainingConsentPage({ details, handle }: TrainingConsentProps) {
  return (
    <TrainingLayout title="Authorize workout sending">
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
        Allow this assistant to create workouts and schedule them for sync to your Garmin watch. You
        will choose your Garmin account and approve Workout Import permission on Garmin’s next
        screen.
      </p>
      <form method="post" action="/training/authorize">
        <input type="hidden" name="handle" value={handle} />
        <p>
          <strong>Requested permissions</strong>
        </p>
        <ul>
          {details.scope.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
        <p>
          <button name="decision" value="approve">
            Continue to Garmin
          </button>
          <button class="secondary" name="decision" value="deny">
            Deny
          </button>
        </p>
      </form>
      <p>
        <a href="/training/privacy">Storage and revocation</a>
      </p>
    </TrainingLayout>
  );
}

export function TrainingErrorPage() {
  return (
    <TrainingLayout title="Connection unsuccessful">
      <h1>Connection unsuccessful.</h1>
      <p>This connection could not be completed. Start again from your assistant.</p>
    </TrainingLayout>
  );
}
