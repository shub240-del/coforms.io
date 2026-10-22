import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES, TRANSLATIONS } from "./interviewI18n";

const unwantedCopy = /interview|entrevista|इंटरव्यू|インタビュー|访谈/iu;

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

describe("localized guided form copy", () => {
  it("does not expose outdated terminology in any supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const strings = TRANSLATIONS[language.code] ?? TRANSLATIONS.en;
      expect(collectStrings(strings).filter(value => unwantedCopy.test(value)), language.label).toEqual([]);
    }
  });
});
