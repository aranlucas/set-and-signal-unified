import type { TOptions } from "i18next";
// Imperative translation for code that cannot use React hooks (exports, timers, and action
// modules). React components use useTranslation() from react-i18next instead.
import { i18n } from "@/i18n/i18n.js";
import type { TranslationKey } from "@/i18n/i18n-types.js";

export function translate(key: TranslationKey, defaultValue: string, values?: TOptions): string {
  return i18n.t(key, defaultValue, values ?? {});
}
