// Screen Wake Lock — keeps the display on while a workout is running, so nobody has to
// unlock their phone between sets.
//
// The browser drops the lock on its own whenever the document stops being visible (tab
// switch, app backgrounded, screen locked by hand). A one-shot request therefore works
// exactly once and then silently dies, which is why `isRequested` is kept as our own intent
// and the lock is re-acquired on every visibilitychange for as long as it holds.
import { useEffect } from "react";

export const wakeLockSupported = () => "wakeLock" in navigator;

let sentinel: WakeLockSentinel | null = null;

let isRequested = false;

let isAcquiring = false;

async function acquireWakeLock() {
  if (!isRequested || sentinel || isAcquiring || !wakeLockSupported()) {
    return;
  }

  if (document.visibilityState !== "visible") {
    return;
  } // request() rejects on a hidden document

  isAcquiring = true;

  try {
    const requestedSentinel = await navigator.wakeLock.request("screen");

    if (!isRequested) {
      requestedSentinel.release().catch(() => {});

      return;
    }

    sentinel = requestedSentinel;
    requestedSentinel.addEventListener("release", () => {
      if (sentinel === requestedSentinel) {
        sentinel = null;
      }
    });
  } catch {
    // iOS refuses in Low Power Mode, and some browsers refuse on low battery. Nothing to
    // do about it and nothing the user could act on — stay quiet and try again next time
    // the document becomes visible.
    sentinel = null;
  } finally {
    isAcquiring = false;
  }
}

const handleVisibilityChange = () => {
  if (document.visibilityState === "visible") {
    void acquireWakeLock().catch(console.error);
  }
};

export function requestWakeLock() {
  if (isRequested) {
    return;
  }

  isRequested = true;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void acquireWakeLock().catch(console.error);
}

export function releaseWakeLock() {
  isRequested = false;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  const releasedSentinel = sentinel;
  sentinel = null;

  if (releasedSentinel) {
    releasedSentinel.release().catch(() => {});
  }
}

export function useWakeLock(enabled: boolean) {
  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      return undefined;
    }

    requestWakeLock();

    return releaseWakeLock;
  }, [enabled]);
}
