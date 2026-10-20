import { describe, expect, it } from "vitest";
import { normalizeSpokenEmail, parseSpokenAnswer, wordToNumber, type QuestionContext } from "./useVoiceForm";

describe("useVoiceForm parsing and validation logic", () => {
  describe("wordToNumber", () => {
    it("converts digits", () => {
      expect(wordToNumber("42")).toBe(42);
      expect(wordToNumber("5.5")).toBe(5.5);
    });

    it("converts word numbers", () => {
      expect(wordToNumber("zero")).toBe(0);
      expect(wordToNumber("one")).toBe(1);
      expect(wordToNumber("five")).toBe(5);
      expect(wordToNumber("ten")).toBe(10);
    });

    it("returns null for non-number words", () => {
      expect(wordToNumber("hello")).toBeNull();
      expect(wordToNumber("")).toBeNull();
    });
  });

  describe("normalizeSpokenEmail", () => {
    it("converts at and dot to email characters", () => {
      expect(normalizeSpokenEmail("jane at example dot com")).toBe("jane@example.com");
      expect(normalizeSpokenEmail("user at sub dot domain dot org")).toBe("user@sub.domain.org");
    });
  });

  describe("parseSpokenAnswer", () => {
    it("handles short_text", () => {
      const q: QuestionContext = { id: "1", type: "short_text", title: "Name" };
      const res = parseSpokenAnswer(q, "  Alice Smith  ");
      expect(res).toEqual({ value: "Alice Smith", display: "Alice Smith" });
    });

    it("validates and accepts valid email", () => {
      const q: QuestionContext = { id: "2", type: "email", title: "Email" };
      const res = parseSpokenAnswer(q, "alice at domain dot com");
      expect(res?.value).toBe("alice@domain.com");
      expect(res?.isAmbiguous).toBeUndefined();
    });

    it("flags incomplete email as ambiguous", () => {
      const q: QuestionContext = { id: "2", type: "email", title: "Email" };
      const res = parseSpokenAnswer(q, "just a name");
      expect(res?.isAmbiguous).toBe(true);
      expect(res?.message).toContain("Please specify a complete email address");
    });

    it("validates rating 1 to 5", () => {
      const q: QuestionContext = { id: "3", type: "rating", title: "Rating" };
      const valid = parseSpokenAnswer(q, "five");
      expect(valid?.value).toBe(5);
      expect(valid?.display).toBe("5 stars");

      const invalid = parseSpokenAnswer(q, "eight");
      expect(invalid?.isAmbiguous).toBe(true);
      expect(invalid?.message).toContain("between 1 and 5 stars");
    });

    it("validates NPS 0 to 10", () => {
      const q: QuestionContext = { id: "4", type: "nps", title: "NPS" };
      const valid = parseSpokenAnswer(q, "ten");
      expect(valid?.value).toBe(10);

      const invalid = parseSpokenAnswer(q, "fifteen");
      expect(invalid?.isAmbiguous).toBe(true);
    });

    it("parses yes_no with synonyms", () => {
      const q: QuestionContext = { id: "5", type: "yes_no", title: "Agree" };
      expect(parseSpokenAnswer(q, "yeah")?.value).toBe("Yes");
      expect(parseSpokenAnswer(q, "nope")?.value).toBe("No");

      const uncertain = parseSpokenAnswer(q, "maybe");
      expect(uncertain?.isAmbiguous).toBe(true);
    });

    it("matches single_choice uniquely and prevents ambiguous multi-match", () => {
      const q: QuestionContext = { id: "6", type: "single_choice", title: "Plan" };
      const options = ["Starter Monthly", "Starter Annual", "Enterprise"];

      // Unique match
      const unique = parseSpokenAnswer(q, "enterprise", options);
      expect(unique?.value).toBe("Enterprise");
      expect(unique?.isAmbiguous).toBeUndefined();

      // Ambiguous match (both Starter Monthly and Starter Annual contain "Starter")
      const ambiguous = parseSpokenAnswer(q, "starter", options);
      expect(ambiguous?.isAmbiguous).toBe(true);
      expect(ambiguous?.message).toContain("Multiple options match");
    });

    it("parses multiple_choice options", () => {
      const q: QuestionContext = { id: "7", type: "multiple_choice", title: "Interests" };
      const options = ["Design", "Coding", "Marketing"];
      const res = parseSpokenAnswer(q, "I like Design and Marketing", options);
      expect(res?.value).toEqual(["Design", "Marketing"]);
    });

    it("returns null for non-voice types (file upload, signature, payment)", () => {
      expect(parseSpokenAnswer({ id: "8", type: "file_upload", title: "Upload" }, "file.png")).toBeNull();
      expect(parseSpokenAnswer({ id: "9", type: "signature", title: "Sign" }, "my signature")).toBeNull();
      expect(parseSpokenAnswer({ id: "10", type: "payment", title: "Pay" }, "10 dollars")).toBeNull();
    });
  });
});
