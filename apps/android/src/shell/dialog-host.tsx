import { AlertDialog, Column, Text, TextButton, useMaterialColors } from "@expo/ui/jetpack-compose";
import { verticalScroll } from "@expo/ui/jetpack-compose/modifiers";
import type { Dialog } from "./types";

interface DialogHostProps {
  dialog: Dialog;
  onDismiss: () => void;
}

export function DialogHost({ dialog, onDismiss }: DialogHostProps) {
  const c = useMaterialColors();

  return (
    <AlertDialog onDismissRequest={onDismiss}>
      <AlertDialog.Title>
        <Text>{dialog.title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Column modifiers={[verticalScroll()]}>
          <Text>{dialog.text}</Text>
        </Column>
      </AlertDialog.Text>
      <AlertDialog.ConfirmButton>
        <TextButton
          onClick={() => {
            const action = dialog.action;
            onDismiss();
            action();
          }}
          colors={dialog.destructive ? { contentColor: c.error } : undefined}
        >
          <Text>{dialog.confirm}</Text>
        </TextButton>
      </AlertDialog.ConfirmButton>
      <AlertDialog.DismissButton>
        <TextButton onClick={onDismiss}>
          <Text>Cancel</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  );
}
