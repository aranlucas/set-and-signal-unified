export type Tab = "Train" | "Plan" | "History" | "Progress" | "Settings";

export type Dialog = {
  title: string;
  text: string;
  confirm: string;
  action: () => void;
  destructive?: boolean;
};
