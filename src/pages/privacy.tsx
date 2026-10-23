import { SiteLayout } from "./layout";

export function PrivacyPage() {
  return (
    <SiteLayout kind="privacy">
      <div class="privacy-intro wrap">
        <a class="back-link" href="/#connect">
          ← Back to setup
        </a>
        <h1>
          Your data.
          <br />
          <span class="accent">Your call.</span>
        </h1>
        <p>How Garmin MCP and Auth use your Garmin Connect data.</p>
      </div>
      <div class="privacy-layout wrap">
        <aside class="contents">
          <nav aria-label="On this page">
            <h2>On this page</h2>
            <a href="#storage">What is stored</a>
            <a href="#ai">AI transparency</a>
            <a href="#disconnect">Your controls</a>
            <a href="#logs">Infrastructure</a>
          </nav>
        </aside>
        <div class="privacy-sections">
          <section class="policy-section" id="storage">
            <span class="section-number">01</span>
            <div>
              <h2>What is stored</h2>
              <p>
                Auth stores your account, linked Garmin identity, encrypted Garmin OAuth tokens, and
                the authorizations you grant to MCP clients. No Personal API key is needed.
              </p>
              <p>
                Garmin MCP stores Health and Activity summaries delivered by Garmin, including the
                measurements and activity details you choose to share. Records are isolated by
                Garmin account and retained for 90 days after the last delivery. Expired records
                stop appearing immediately and are deleted by a daily cleanup.
              </p>
              <p>
                Health and activity collection begins after linking and syncing with Garmin. Garmin
                Starter provides no historical backfill. Workouts and calendar changes are sent to
                Garmin when you request them; Garmin controls device synchronization.
              </p>
            </div>
          </section>
          <section class="policy-section" id="ai">
            <span class="section-number">02</span>
            <div>
              <h2>AI transparency and consent</h2>
              <p>
                Connecting this server to an AI assistant allows that client and its AI provider to
                process the Garmin data returned by tools to answer your questions and prepare
                workouts. Review the client name, requested permissions, and its privacy terms
                before approving Auth consent. Connect only a client whose data controls prevent
                Garmin data from being used to train, evaluate, or improve AI models.
              </p>
              <p>
                We do not sell Garmin data or use it to train, evaluate, or improve AI models. The
                connector calls no AI provider itself. Your chosen MCP client and AI provider
                receive the tool results you request and handle them under their own policies.
                Approving the connector grants that processing; you can withdraw by disconnecting
                the client or Garmin.
              </p>
            </div>
          </section>
          <section class="policy-section" id="disconnect">
            <span class="section-number">03</span>
            <div>
              <h2>Access, export, correction, and deletion</h2>
              <p>
                Use list_garmin_summaries and get_garmin_summary to access or export received data.
                Correct the original data in Garmin Connect; later Garmin deliveries replace
                matching summaries. Use delete_stored_garmin_data to remove retained Health/Activity
                records. Future syncs can deliver new records while Garmin remains connected.
              </p>
              <p>
                To stop collection and withdraw consent, disconnect Garmin in{" "}
                <a href="https://auth.aranlucas.workers.dev/account">Auth connected accounts</a> or
                remove this app in Garmin Connect. Auth disconnect revokes the Garmin registration
                and deletes retained summaries. Garmin deregistration notifications also delete
                retained summaries and block late delivery retries.
              </p>
              <p>
                Remove the connector in your assistant to stop that client’s access. Auth access
                tokens expire within 15 minutes; the private Garmin broker also checks the current
                link on every request. Copies already returned to your assistant must be deleted
                with that provider.
              </p>
            </div>
          </section>
          <section class="policy-section" id="logs">
            <span class="section-number">04</span>
            <div>
              <h2>Hosting and logs</h2>
              <p>
                Cloudflare hosts Auth, encrypted credentials, and Garmin MCP’s stored data. Garmin
                processes authorization, account permissions, workouts, and synchronization. Your
                chosen MCP and AI providers process the results you request. These are the services
                involved in delivering the integration.
              </p>
              <p>
                The connector does not log Garmin tokens, delivery credentials, authorization codes,
                health payloads, or tool arguments. Request URL tracing and automatic invocation
                logs are disabled on the delivery service. Operational failures use redacted event
                names. Cloudflare and Garmin may retain their own platform logs under their
                policies.
              </p>
            </div>
          </section>
        </div>
      </div>
    </SiteLayout>
  );
}
