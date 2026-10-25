import type { SnackbarHostRef } from "@expo/ui/jetpack-compose";

let host: SnackbarHostRef | null = null;

export function bindSnackbar(value: SnackbarHostRef | null) {
  host = value;
}

export function notify(message: string) {
  if (message) {
    void host
      ?.showSnackbar({
        message,
        withDismissAction: true,
        duration: "long",
      })
      .catch(() => {});
  }
}
