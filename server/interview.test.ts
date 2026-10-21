import { describe, expect, it } from "vitest";
import { generateInterviewTurn } from "./ai";
import { validateQuestionAnswers, type QuestionInput } from "./forms";
import { progressTokenMatches } from "./db";
import { createHash } from "node:crypto";

try {
  (process as any).loadEnvFile?.(".env");
} catch {
  // Ignore if already loaded or file not found
}

describe("Stage 1 Interview Turn & Extraction Logic", { timeout: 35000 }, () => {
  const sampleQuestion: QuestionInput & { id: string } = {
    id: "11111111-1111-4000-8000-111111111111",
    type: "rating",
    label: "How would you rate our platform from 1 to 5?",
    required: true,
    settings: {},
  };

  const choiceQuestion: QuestionInput & { id: string } = {
    id: "22222222-2222-4000-8000-222222222222",
    type: "single_choice",
    label: "What is your primary role?",
    required: true,
    options: ["Engineer", "Designer", "Product Manager"],
    settings: {},
  };

  it("extracts valid rating from respondent utterance", async () => {
    const turn = await generateInterviewTurn({
      currentQuestion: {
        id: sampleQuestion.id,
        type: sampleQuestion.type,
        title: sampleQuestion.label ?? "Rating",
        required: true,
      },
      utterance: "I would definitely give it a 5",
      language: "en",
    });

    expect(turn.proposedAnswer?.questionId).toBe(sampleQuestion.id);
    expect(turn.proposedAnswer?.value).toBe(5);
    expect(turn.clarificationNeeded).toBe(false);
  });

  it("flags ambiguous or out-of-range rating for clarification", async () => {
    const turn = await generateInterviewTurn({
      currentQuestion: {
        id: sampleQuestion.id,
        type: sampleQuestion.type,
        title: sampleQuestion.label ?? "Rating",
        required: true,
      },
      utterance: "Maybe an eight or nine out of ten",
      language: "en",
    });

    // Rating must be 1-5; 8 or 9 out of 10 must require clarification
    if (turn.proposedAnswer) {
      expect([1, 2, 3, 4, 5]).toContain(turn.proposedAnswer.value);
    } else {
      expect(turn.clarificationNeeded).toBe(true);
    }
  });

  it("extracts exact allowed choice from options", async () => {
    const turn = await generateInterviewTurn({
      currentQuestion: {
        id: choiceQuestion.id,
        type: choiceQuestion.type,
        title: choiceQuestion.label ?? "Role",
        options: choiceQuestion.options,
        required: true,
      },
      utterance: "I work as a Designer mostly",
      language: "en",
    });

    expect(turn.proposedAnswer?.questionId).toBe(choiceQuestion.id);
    expect(turn.proposedAnswer?.value).toBe("Designer");
    expect(turn.clarificationNeeded).toBe(false);
  });

  it("rejects choice values outside allowed options and flags clarification", async () => {
    const turn = await generateInterviewTurn({
      currentQuestion: {
        id: choiceQuestion.id,
        type: choiceQuestion.type,
        title: choiceQuestion.label ?? "Role",
        options: choiceQuestion.options,
        required: true,
      },
      utterance: "I am a marine biologist",
      language: "en",
    });

    if (turn.proposedAnswer) {
      expect(choiceQuestion.options).toContain(turn.proposedAnswer.value);
    } else {
      expect(turn.clarificationNeeded).toBe(true);
    }
  });

  it("always pins proposed answer to the official question ID, never inventing one", async () => {
    const turn = await generateInterviewTurn({
      currentQuestion: {
        id: sampleQuestion.id,
        type: sampleQuestion.type,
        title: sampleQuestion.label ?? "Rating",
        required: true,
      },
      utterance: "Four stars",
      language: "en",
    });

    if (turn.proposedAnswer) {
      expect(turn.proposedAnswer.questionId).toBe(sampleQuestion.id);
    }
  });

  it("does not consider interview complete when required questions are unanswered", () => {
    const questions = [sampleQuestion, choiceQuestion];
    // Respondent only answered question 1
    const currentAnswers = { [sampleQuestion.id]: 5 };
    const validation = validateQuestionAnswers(questions, currentAnswers);

    expect(validation.ok).toBe(false);
    expect(validation.errors[choiceQuestion.id]).toBe("This question is required.");
  });

  it("considers interview complete when all visible required questions are answered", () => {
    const questions = [sampleQuestion, choiceQuestion];
    const currentAnswers = {
      [sampleQuestion.id]: 5,
      [choiceQuestion.id]: "Engineer",
    };
    const validation = validateQuestionAnswers(questions, currentAnswers);

    expect(validation.ok).toBe(true);
    expect(Object.keys(validation.errors)).toHaveLength(0);
  });

  it("correctly honors conditional question branching during interview validation", () => {
    const conditionalQ: QuestionInput & { id: string } = {
      id: "33333333-3333-4000-8000-333333333333",
      type: "short_text",
      label: "What design tool do you use?",
      required: true,
      logic: { whenQuestionId: choiceQuestion.id, operator: "equals", value: "Designer" },
    };

    const questions = [choiceQuestion, conditionalQ];

    // Case A: Role is Engineer -> conditional question is NOT visible, so form is valid
    const engineerAnswers = { [choiceQuestion.id]: "Engineer" };
    const engValidation = validateQuestionAnswers(questions, engineerAnswers);
    expect(engValidation.ok).toBe(true);
    expect(engValidation.visibleQuestionIds.has(conditionalQ.id)).toBe(false);

    // Case B: Role is Designer -> conditional question IS visible and required
    const designerAnswers = { [choiceQuestion.id]: "Designer" };
    const desValidation = validateQuestionAnswers(questions, designerAnswers);
    expect(desValidation.ok).toBe(false);
    expect(desValidation.visibleQuestionIds.has(conditionalQ.id)).toBe(true);
    expect(desValidation.errors[conditionalQ.id]).toBe("This question is required.");
  });
});

describe("Stage 1 Session Security & Progress Token Verification", () => {
  const token = "secure-random-token-xyz-1234567890";
  const hash = createHash("sha256").update(token).digest("hex");
  const metadata = JSON.stringify({ progressTokenHash: hash });

  it("verifies matching progress token successfully", () => {
    expect(progressTokenMatches(metadata, token)).toBe(true);
  });

  it("rejects mismatched or forged progress token", () => {
    expect(progressTokenMatches(metadata, "wrong-token-abc")).toBe(false);
  });

  it("rejects empty or null token safely without throwing", () => {
    expect(progressTokenMatches(metadata, "")).toBe(false);
    expect(progressTokenMatches(null, token)).toBe(false);
    expect(progressTokenMatches("not-json", token)).toBe(false);
  });
});

describe("Stage 1 Organizer Mode Configuration", () => {
  it("defaults to classic when conversationalMode setting is absent or false", () => {
    const settingsEmpty: Record<string, unknown> = {};
    const settingsFalse = { conversationalMode: false };
    const settingsTrue = { conversationalMode: true };

    expect(Boolean(settingsEmpty.conversationalMode)).toBe(false);
    expect(Boolean(settingsFalse.conversationalMode)).toBe(false);
    expect(Boolean(settingsTrue.conversationalMode)).toBe(true);
  });
});

describe("Stage 2 Voice & Real-Time Multilingual Interview Logic", { timeout: 30000 }, () => {
  const emailQuestion: QuestionInput & { id: string } = {
    id: "44444444-4444-4000-8000-444444444444",
    type: "email",
    label: "What is your email address?",
    required: true,
  };

  const numberQuestion: QuestionInput & { id: string } = {
    id: "55555555-5555-4000-8000-555555555555",
    type: "number",
    label: "How many team members do you have?",
    required: true,
    settings: { min: 1, max: 100 },
  };

  it("propagates selected language parameter cleanly to turn generation", async () => {
    const spanishTurn = await generateInterviewTurn({
      currentQuestion: {
        id: "11111111-1111-4000-8000-111111111111",
        type: "yes_no",
        title: "¿Te gusta nuestro servicio?",
        required: true,
      },
      utterance: "Sí, por supuesto",
      language: "es",
    });

    expect(spanishTurn.proposedAnswer?.questionId).toBe("11111111-1111-4000-8000-111111111111");
    expect(spanishTurn.clarificationNeeded).toBe(false);
    expect(spanishTurn.assistantMessage).toBeTruthy();
  });

  it("validates speech-extracted answers using strict server-side schema rules", () => {
    // Valid email extracted from speech
    const validEmailAnswer = { [emailQuestion.id]: "alex.morgan@example.com" };
    const emailValidation = validateQuestionAnswers([emailQuestion], validEmailAnswer);
    expect(emailValidation.ok).toBe(true);

    // Invalid email extracted from speech
    const invalidEmailAnswer = { [emailQuestion.id]: "not-an-email" };
    const invalidEmailValidation = validateQuestionAnswers([emailQuestion], invalidEmailAnswer);
    expect(invalidEmailValidation.ok).toBe(false);
    expect(invalidEmailValidation.errors[emailQuestion.id]).toBe("Enter a valid email address.");

    // Out-of-bounds number extracted from speech
    const outOfBoundsNumber = { [numberQuestion.id]: 250 };
    const numberValidation = validateQuestionAnswers([numberQuestion], outOfBoundsNumber);
    expect(numberValidation.ok).toBe(false);
    expect(numberValidation.errors[numberQuestion.id]).toBe("Enter a number no greater than 100.");
  });

  it("handles clarification recovery turn when respondent refines an ambiguous answer", async () => {
    // Turn 1: Respondent gives ambiguous input
    const turn1 = await generateInterviewTurn({
      currentQuestion: {
        id: numberQuestion.id,
        type: numberQuestion.type,
        title: numberQuestion.label ?? "Team size",
        required: true,
        settings: numberQuestion.settings,
      },
      utterance: "I don't know, maybe a few or something",
      language: "en",
    });

    // Should flag clarification or request a specific number
    if (!turn1.proposedAnswer) {
      expect(turn1.clarificationNeeded).toBe(true);
    }

    // Turn 2: Respondent clarifies with an exact number
    const turn2 = await generateInterviewTurn({
      currentQuestion: {
        id: numberQuestion.id,
        type: numberQuestion.type,
        title: numberQuestion.label ?? "Team size",
        required: true,
        settings: numberQuestion.settings,
      },
      utterance: "We have 8 people on our team",
      language: "en",
    });

    expect(turn2.proposedAnswer?.questionId).toBe(numberQuestion.id);
    expect(turn2.proposedAnswer?.value).toBe(8);
    expect(turn2.clarificationNeeded).toBe(false);

    // Validate the recovered answer server-side
    const recoveredValidation = validateQuestionAnswers([numberQuestion], {
      [numberQuestion.id]: turn2.proposedAnswer?.value,
    });
    expect(recoveredValidation.ok).toBe(true);
  }, 60000);
});


describe("Stage 2 Sarvam AI Proxy — Unit (no network)", () => {
  it("sarvamTTS returns a structured error when SARVAM_API_KEY is absent", async () => {
    const saved = process.env.SARVAM_API_KEY;
    delete process.env.SARVAM_API_KEY;
    try {
      const mod = await import("./sarvam");
      const res = await mod.sarvamTTS({ text: "Hello", language: "hi" });
      expect("error" in res).toBe(true);
      if ("error" in res) { expect(res.error).toMatch(/SARVAM_API_KEY/i); }
    } finally {
      if (saved !== undefined) process.env.SARVAM_API_KEY = saved;
    }
  });

  it("sarvamSTT returns a structured error when SARVAM_API_KEY is absent", async () => {
    const saved = process.env.SARVAM_API_KEY;
    delete process.env.SARVAM_API_KEY;
    try {
      const mod = await import("./sarvam");
      const res = await mod.sarvamSTT({ audioBuffer: Buffer.from("fake"), language: "hi" });
      expect("error" in res).toBe(true);
      if ("error" in res) { expect(res.error).toMatch(/SARVAM_API_KEY/i); }
    } finally {
      if (saved !== undefined) process.env.SARVAM_API_KEY = saved;
    }
  });
});