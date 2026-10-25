import { useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { z } from "zod";
import { Action, Caption, Field, Heading } from "../components/ui";
import {
  cloudApi,
  importDeviceHistory,
  retryCloud,
  signIn,
  signOut,
  useCloud,
  recoveryFile,
} from "../data/cloud";
import { shareTrainingFile } from "../data/exports";
import { notify } from "../data/notices";

export function CloudAccountPanel() {
  const cloud = useCloud();

  const [base, setBase] = useState<string>(() => {
    const configured: unknown = process.env.EXPO_PUBLIC_API_URL;

    return z.string().catch("https://opengym2.up.railway.app").parse(configured);
  });

  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const uid = cloud.user?.id;
  useEffect(() => {
    let alive = true;

    if (uid) {
      void (async () => {
        const value = await cloudApi("/api/garmin/status");

        if (alive) {
          setConnected(z.object({ connected: z.boolean() }).parse(value).connected);
        }
      })().catch((cause: unknown) => {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "Could not check Garmin connection");
        }
      });
    }

    return () => {
      alive = false;
    };
  }, [uid]);

  const run = (action: () => Promise<void>) => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");
    void action()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Couldn't finish that action"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Heading>{cloud.user ? cloud.user.name : "Your training account"}</Heading>
      {cloud.user ? (
        <>
          <Caption>{cloud.base}</Caption>
          <Caption>
            {cloud.phase === "saved"
              ? "Training synchronized"
              : `${cloud.phase} · ${cloud.pending} pending edits`}
          </Caption>
          <Action disabled={busy} onPress={() => run(retryCloud)}>
            Sync now
          </Action>
          <Action secondary disabled={busy} onPress={() => run(importDeviceHistory)}>
            Import this phone's workout history
          </Action>
          <Caption>
            Imports merge with this account. Existing phone records keep their identities; other
            accounts stay separate.
          </Caption>
          <Heading>Garmin</Heading>
          <Caption>
            {connected
              ? "Connected · workouts, recordings and health context"
              : "Connect to send workouts to your watch and review recorded results."}
          </Caption>
          <Action
            disabled={busy}
            onPress={() =>
              run(async () => {
                const { url } = z
                  .object({ url: z.url() })
                  .parse(await cloudApi("/api/garmin/connect", { method: "POST", body: "{}" }));

                await WebBrowser.openBrowserAsync(url);

                const status = z
                  .object({ connected: z.boolean() })
                  .parse(await cloudApi("/api/garmin/status"));

                setConnected(status.connected);
              })
            }
          >
            {connected ? "Reconnect Garmin" : "Connect Garmin"}
          </Action>
          {connected ? (
            <Action
              secondary
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await cloudApi("/api/garmin/disconnect", { method: "POST", body: "{}" });
                  setConnected(false);
                })
              }
            >
              Disconnect Garmin
            </Action>
          ) : null}
          <Action
            subtle
            onPress={() =>
              run(async () => {
                await shareTrainingFile(recoveryFile(), "set-and-signal-recovery.json");
                notify("Training recovery file exported");
              })
            }
          >
            Export account data & pending edits
          </Action>
          <Action subtle disabled={busy} onPress={() => run(signOut)}>
            Sign out
          </Action>
        </>
      ) : (
        <>
          <Caption>
            Use the same account on Android and web. You can keep training locally without signing
            in.
          </Caption>
          <Field label="Set & Signal server" value={base} onChange={setBase} maxLength={256} />
          <Action disabled={busy} onPress={() => run(() => signIn(base))}>
            Sign in with your browser
          </Action>
        </>
      )}
      {error || cloud.error ? <Caption>{error || cloud.error}</Caption> : null}
    </>
  );
}
