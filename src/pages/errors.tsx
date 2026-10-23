import { ConsentLayout } from "./layout";

export function KeyErrorPage() {
  return (
    <ConsentLayout title="Check your key">
      <h1>Check your Personal API key.</h1>
      <p>
        Enter the key generated in Garmin Connect, then start the connection again from your
        assistant.
      </p>
    </ConsentLayout>
  );
}

type AuthorizationErrorPageProps = { message: string };

export function AuthorizationErrorPage({ message }: AuthorizationErrorPageProps) {
  return (
    <ConsentLayout title="Connection unsuccessful">
      <h1>Connection unsuccessful.</h1>
      <p>{message}</p>
      <p>No new Garmin connection was saved. Start the connection again from your assistant.</p>
    </ConsentLayout>
  );
}
