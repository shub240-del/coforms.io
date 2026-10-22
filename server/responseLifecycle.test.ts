import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const state = vi.hoisted(() => ({
  form: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Lifecycle test",
    description: null,
    slug: "lifecycle-test-form",
    status: "published",
    theme: "{}",
    settings: "{}",
  },
  questions: [
    { id: "22222222-2222-4222-8222-222222222222", position: 0, type: "nps", label: "How likely are you to recommend us?", description: null, required: 1, settings: "{}", logic: null },
    { id: "33333333-3333-4333-8333-333333333333", position: 1, type: "checkbox", label: "Would you like a follow-up?", description: null, required: 0, settings: "{}", logic: null },
    { id: "44444444-4444-4444-8444-444444444444", position: 2, type: "short_text", label: "Anything else?", description: null, required: 0, settings: "{}", logic: null },
  ],
  responseId: "55555555-5555-4555-8555-555555555555",
  progressToken: "test-progress-token-0123456789abcdef",
  responseStatus: "in_progress" as "in_progress" | "submitted",
  answerRows: [] as Array<{ responseId: string; questionId: string; value: string }>,
  getPublishedFormBySlug: vi.fn(),
  getQuestions: vi.fn(),
  getAllQuestions: vi.fn(),
  startFormResponse: vi.fn(),
  completeFormResponse: vi.fn(),
  listResponsesForAccount: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPublishedFormBySlug: state.getPublishedFormBySlug,
    getQuestions: state.getQuestions,
    getAllQuestions: state.getAllQuestions,
    startFormResponse: state.startFormResponse,
    completeFormResponse: state.completeFormResponse,
    listResponsesForAccount: state.listResponsesForAccount,
  };
});

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function caller() {
  const ctx: TrpcContext = {
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
    appUser: {
      id: accountId,
      email: "respondent@example.invalid",
      name: "Test account",
      passwordHash: null,
      provider: "password",
      providerSubject: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    appSessionToken: null,
  };
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  state.responseStatus = "in_progress";
  state.answerRows = [];
  state.getPublishedFormBySlug.mockReset().mockResolvedValue(state.form);
  state.getQuestions.mockReset().mockResolvedValue(state.questions);
  state.getAllQuestions.mockReset().mockResolvedValue(state.questions);
  state.startFormResponse.mockReset().mockImplementation(async () => ({
    responseId: state.responseId,
    progressToken: state.progressToken,
  }));
  state.completeFormResponse.mockReset().mockImplementation(async ({ formId, responseId, progressToken, answers }) => {
    if (formId !== state.form.id || responseId !== state.responseId || progressToken !== state.progressToken || state.responseStatus !== "in_progress") return false;
    state.responseStatus = "submitted";
    state.answerRows = answers.map((answer: { questionId: string; value: unknown }) => ({
      responseId,
      questionId: answer.questionId,
      value: JSON.stringify(answer.value),
    }));
    return true;
  });
  state.listResponsesForAccount.mockImplementation(async () => ({
    form: state.form,
    responses: state.responseStatus === "submitted"
      ? [{ id: state.responseId, status: "submitted", submittedAt: new Date("2026-10-22T00:00:00.000Z") }]
      : [],
    answers: state.answerRows,
    metrics: { started: 1, submitted: state.responseStatus === "submitted" ? 1 : 0, questionViews: [] },
  }));
});

describe("form submission to response analytics lifecycle", () => {
  it("validates, records, retrieves and safely exports a synthetic submission", async () => {
    const api = caller();
    const session = await api.forms.start({ slug: state.form.slug });

    await expect(api.forms.submit({
      slug: state.form.slug,
      responseId: session.responseId,
      progressToken: session.progressToken,
      answers: {
        [state.questions[1]!.id]: false,
        [state.questions[2]!.id]: "=HYPERLINK(\"https://example.invalid\")",
      },
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.responseStatus).toBe("in_progress");
    expect(state.answerRows).toHaveLength(0);

    const submitted = await api.forms.submit({
      slug: state.form.slug,
      responseId: session.responseId,
      progressToken: session.progressToken,
      answers: {
        [state.questions[0]!.id]: 0,
        [state.questions[1]!.id]: false,
        [state.questions[2]!.id]: "=HYPERLINK(\"https://example.invalid\")",
      },
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted).toMatchObject({ responseId: state.responseId, status: "submitted", redirectUrl: null });
    expect(state.responseStatus).toBe("submitted");

    const responses = await api.forms.responses({ formId: state.form.id });
    expect(responses.responses).toHaveLength(1);
    expect(responses.responses[0]?.answers[state.questions[0]!.id]).toBe(0);
    expect(responses.responses[0]?.answers[state.questions[1]!.id]).toBe(false);
    expect(responses.metrics).toMatchObject({ started: 1, submitted: 1, completionRate: 100 });

    const csv = await api.forms.responsesCsv({ formId: state.form.id });
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
  });

  it("rejects a second submission for the same completed response", async () => {
    const api = caller();
    const session = await api.forms.start({ slug: state.form.slug });
    const answers = { [state.questions[0]!.id]: 8 };

    await api.forms.submit({ slug: state.form.slug, responseId: session.responseId, progressToken: session.progressToken, answers });
    await expect(api.forms.submit({ slug: state.form.slug, responseId: session.responseId, progressToken: session.progressToken, answers }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.answerRows).toHaveLength(1);
  });
});
