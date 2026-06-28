// Frontend copy lives in per-locale JSON files so the pages carry no inline
// English strings and adding a language is just adding a JSON file. English is the
// source of truth and the fallback. To add a locale, import its JSON and register
// it in LOCALES; the resolver already prefers the browser language when present.
import en from "./en.json" with { type: "json" };

export type Strings = typeof en;

const LOCALES: Record<string, Strings> = { en };

function resolveLocale(): string {
  try {
    return (navigator.language || "en").slice(0, 2).toLowerCase();
  } catch {
    return "en";
  }
}

export function loadStrings(locale: string = resolveLocale()): Strings {
  return LOCALES[locale] ?? en;
}

// The active locale's strings. Pages read fields off this object.
export const t: Strings = loadStrings();
