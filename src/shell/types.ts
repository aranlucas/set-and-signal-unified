export type Tab = "Train" | "History" | "Progress" | "Settings";

export type Dialog = {
  title: string;
  text: string;
  confirm: string;
  action: () => void;
  destructive?: boolean;
};
