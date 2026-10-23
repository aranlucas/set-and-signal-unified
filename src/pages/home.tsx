import { SiteLayout } from "./layout";
import { garminKeyUrl } from "./links";
import { Icon } from "./icon";

type HomePageProps = { publicUrl: string };

export function HomePage({ publicUrl }: HomePageProps) {
  return (
    <SiteLayout kind="home">
      <section class="hero wrap" aria-labelledby="hero-title">
        <div>
          <h1 id="hero-title">
            Your training.
            <br />
            <span class="accent">A better conversation.</span>
          </h1>
          <p class="hero-intro">
            Bring your activities, sleep, and recovery into your AI assistant. Ask better questions
            with your own Garmin data.
          </p>
          <a class="button" href="#connect">
            Connect your assistant <span aria-hidden="true">↗</span>
          </a>
          <p class="hero-note">Read only · Your key stays private</p>
        </div>
        <div class="conversation" aria-label="Example question using your Garmin data">
          <p class="conversation-label">A conversation with your data</p>
          <p class="chat-prompt">How did I sleep after my long run?</p>
          <div class="chat-data">
            <span class="brand-icon">
              <Icon name="pulse" />
            </span>
            <div class="data-panel">
              <p class="data-label">Context from your Garmin data</p>
              <div class="data-row">
                <Icon name="activity" />
                <div>
                  <strong>Activities</strong>
                  <span>Your runs, rides, and more</span>
                </div>
              </div>
              <div class="data-row">
                <Icon name="moon" />
                <div>
                  <strong>Sleep</strong>
                  <span>Sleep data and sleep stages</span>
                </div>
              </div>
              <div class="data-row">
                <Icon name="heart" />
                <div>
                  <strong>Recovery</strong>
                  <span>HRV and Body Battery</span>
                </div>
              </div>
            </div>
          </div>
          <p class="chat-note">Your data. More context.</p>
        </div>
      </section>
      <section class="features wrap" aria-label="What you can connect">
        <article class="feature">
          <Icon name="activity" />
          <h2>Training, in context.</h2>
          <p>
            Bring your activities into the conversation. Ask about your runs, rides, strength
            sessions, and more, in the context of your bigger picture.
          </p>
          <ul>
            <li>Runs, rides, and other activities</li>
            <li>Activity details and workouts</li>
            <li>Recent and historical data</li>
          </ul>
        </article>
        <article class="feature">
          <Icon name="moon" />
          <h2>Recovery, connected.</h2>
          <p>
            Include sleep and recovery data to get a fuller picture. Look at how your training fits
            with your rest and daily energy.
          </p>
          <ul>
            <li>Sleep data and sleep stages</li>
            <li>Heart rate variability (HRV)</li>
            <li>Body Battery and daily health</li>
          </ul>
        </article>
        <article class="feature">
          <Icon name="lock" />
          <h2>Access, on your terms.</h2>
          <p>
            You control what’s shared. Access is read only, your key is encrypted, and sensitive
            data like women’s health requires separate consent.
          </p>
          <ul>
            <li>Encrypted key, read-only access</li>
            <li>Separate women’s health consent</li>
            <li>Disconnect at any time</li>
          </ul>
        </article>
      </section>
      <section class="setup-band" aria-labelledby="setup-title">
        <div class="setup wrap" id="connect">
          <div class="setup-intro">
            <h2 id="setup-title">
              One connection.
              <br />
              <span class="accent">More perspective.</span>
            </h2>
            <p>
              Set up Garmin Personal MCP in a few simple steps and bring your own data into your
              MCP-compatible AI assistant.
            </p>
          </div>
          <div>
            <ol class="steps">
              <li>
                <h3>Create your Garmin key</h3>
                <p>
                  Create a Personal API key in Garmin Connect. Save it somewhere safe: Garmin shows
                  it only once.
                </p>
                <a href={garminKeyUrl} target="_blank" rel="noopener noreferrer">
                  Create a Garmin key <span aria-hidden="true">↗</span>
                  <span class="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
              <li>
                <h3>Add the MCP server</h3>
                <p>
                  Add a remote HTTP connector in your assistant and choose OAuth authentication.
                </p>
                <div class="endpoint">
                  <label for="mcp-url">MCP server URL</label>
                  <input
                    id="mcp-url"
                    type="text"
                    readonly
                    spellcheck={false}
                    value={`${publicUrl}/mcp`}
                    aria-describedby="endpoint-help"
                  />
                </div>
                <p class="endpoint-help" id="endpoint-help">
                  Select the URL and copy it into your assistant.
                </p>
              </li>
              <li>
                <h3>Approve your connection</h3>
                <p>
                  Start the connection from your assistant. Check the client and return address,
                  enter your Garmin key, and approve access.
                </p>
                <p>Women’s health data requires separate consent.</p>
              </li>
            </ol>
            <p class="setup-note">
              This uses Garmin’s official Personal API. Your assistant receives its own MCP token.
              Your Garmin key stays encrypted in the authorization grant and is never returned by
              MCP tools.
            </p>
          </div>
        </div>
      </section>
      <section class="privacy-band" aria-labelledby="privacy-cta-title">
        <div class="privacy-cta wrap">
          <Icon name="shield" />
          <div>
            <h2 id="privacy-cta-title">Your data stays yours.</h2>
            <p>Read-only access. No health data stored by this server.</p>
          </div>
          <a href="/privacy">
            Read the privacy details <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
    </SiteLayout>
  );
}
