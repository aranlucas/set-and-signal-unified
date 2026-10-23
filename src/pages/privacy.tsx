import { SiteLayout } from "./layout";
import { garminKeyUrl } from "./links";

export function PrivacyPage() {
  return (
    <SiteLayout kind="privacy">
      <div class="privacy-intro wrap">
        <a class="back-link" href="/#connect">
          <span aria-hidden="true">←</span> Back to setup
        </a>
        <h1>
          Your data.
          <br />
          <span class="accent">Your call.</span>
        </h1>
        <p>A clear look at what this server stores, how access works, and how to disconnect.</p>
      </div>
      <div class="privacy-layout wrap">
        <aside class="contents">
          <nav aria-label="On this page">
            <h2>On this page</h2>
            <a href="#storage">What is stored</a>
            <a href="#expiry">Access and expiry</a>
            <a href="#disconnect">Disconnect</a>
            <a href="#logs">Logs and infrastructure</a>
          </nav>
        </aside>
        <div class="privacy-sections">
          <section class="policy-section" id="storage" aria-labelledby="storage-title">
            <span class="section-number" aria-hidden="true">
              01
            </span>
            <div>
              <h2 id="storage-title">What is stored</h2>
              <p>
                This server stores OAuth client registrations, consent transactions, and
                authorization grants in Cloudflare KV.
              </p>
              <p>
                Your Garmin Personal API key is encrypted within each grant by Cloudflare’s OAuth
                provider library. The server decrypts it to call Garmin. Use a deployment you trust.
              </p>
              <p class="callout">
                <strong>Health data is not persisted.</strong> Garmin access tokens and API
                responses are held only for the current request.
              </p>
            </div>
          </section>
          <section class="policy-section" id="expiry" aria-labelledby="expiry-title">
            <span class="section-number" aria-hidden="true">
              02
            </span>
            <div>
              <h2 id="expiry-title">Access and expiry</h2>
              <table class="expiry-table">
                <caption class="sr-only">Authorization token and key expiration</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>MCP access token</td>
                    <td>1 hour</td>
                  </tr>
                  <tr>
                    <td>MCP refresh token and grant</td>
                    <td>30 days</td>
                  </tr>
                  <tr>
                    <td>Garmin Personal API key</td>
                    <td>Expiry chosen in Garmin Connect</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section class="policy-section" id="disconnect" aria-labelledby="disconnect-title">
            <span class="section-number" aria-hidden="true">
              03
            </span>
            <div>
              <h2 id="disconnect-title">Disconnect</h2>
              <ol class="disconnect-steps">
                <li>
                  <h3>Delete your Garmin key</h3>
                  <p>
                    Delete your Personal API key in <a href={garminKeyUrl}>Garmin Connect</a> to
                    stop upstream access. Garmin says this also invalidates its associated Garmin
                    access tokens.
                  </p>
                </li>
                <li>
                  <h3>Revoke your MCP connection</h3>
                  <p>
                    Revoke your MCP <strong>refresh token</strong> through the OAuth revocation
                    endpoint advertised by this server to revoke the entire grant. Revoking only an
                    access token does not revoke the full refreshable session. Then remove the
                    connector from your assistant.
                  </p>
                </li>
              </ol>
              <p class="callout">
                <strong>Deleting your Garmin key does not erase the encrypted MCP grant.</strong>{" "}
                Revoke the grant or let it expire. The deployment owner can erase the dedicated KV
                namespace to delete all authorization records.
              </p>
            </div>
          </section>
          <section class="policy-section" id="logs" aria-labelledby="logs-title">
            <span class="section-number" aria-hidden="true">
              04
            </span>
            <div>
              <h2 id="logs-title">Logs and infrastructure</h2>
              <p>
                Application logs contain generic error events. Credentials and health payloads are
                not included in application logs.
              </p>
              <p>
                Cloudflare infrastructure processes requests under the deployment owner’s account.
              </p>
            </div>
          </section>
        </div>
      </div>
    </SiteLayout>
  );
}
