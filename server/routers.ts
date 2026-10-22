import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { decodeSarvamAudio, MAX_SARVAM_AUDIO_BASE64_LENGTH } from "./audio";
import { COOKIE_NAME } from "@shared/const";
import { publicAccount, SPACEFORM_SESSION_COOKIE, createAppSession, googleConfiguration, hashPassword, loginAccount, normalizeEmail, revokeAppSession, signupAccount } from "./auth";
import { generateDraft, generateInterviewTurn } from "./ai";
import { sarvamSTT, sarvamTTS } from "./sarvam";
import { bindPublicUploadsToResponse, completeFormResponse, consumePasswordResetToken, createForm, createPasswordResetToken, getAccountByEmail, getDb, getFormForAccount, getPublicUploadForQuestion, getPublishedFormBySlug, getQuestions, getAllQuestions, invalidatePasswordResetToken, isPasswordResetTokenValid, listFormsForAccount, listResponsesForAccount, progressTokenMatches, recordResponseQuestionView, setFormPublished, startFormResponse, updateForm } from "./db";
import { createPasswordResetTokenPair, hashPasswordResetToken, passwordResetExpiresAt, passwordResetIsConfigured, passwordResetLink, sendPasswordResetEmail } from "./passwordReset";
import { answersSchema, editRequiresUnpublishForPayment, parseJson, publicQuestion, questionInputSchema, respondentQuestion, responsesToCsv, validateQuestionAnswers } from "./forms";
import { preparePublicUpload } from "./uploads";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { sfResponses } from "../drizzle/schema";

const accountInput = z.object({ name: z.string().trim().min(1).max(160), email: z.string().email().max(320), password: z.string().min(12).max(200) });
const safeHttpsUrl = (value: string) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
const redirectUrlInput = z.string().trim().max(2048).refine(value => value === "" || (value.startsWith("/") && !value.startsWith("//")) || safeHttpsUrl(value), "Use a same-site path or a secure HTTPS URL.");
const logoUrlInput = z.string().trim().max(2048).refine(value => value === "" || safeHttpsUrl(value), "Use a secure HTTPS image URL.");
const formSettingsInput = z.object({ thankYouText: z.string().trim().max(500).optional(), redirectUrl: redirectUrlInput.optional(), logoUrl: logoUrlInput.optional(), conversationalMode: z.boolean().optional() });
const formUpdateInput = z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(255), description: z.string().max(5000).nullable().optional(), questions: z.array(questionInputSchema).max(100), theme: z.record(z.string(), z.unknown()).nullable().optional(), settings: formSettingsInput.optional() });
function setAppCookie(res: any, token: string, expiresAt: Date) { res.cookie(SPACEFORM_SESSION_COOKIE, token, { ...getSessionCookieOptions(res.req), maxAge: Math.max(0, expiresAt.getTime() - Date.now()) }); }
function publicForm(form: any, questions: any[], includeLogic = true) { return { id: form.id, title: form.title, description: form.description, slug: form.slug, status: form.status, theme: parseJson(form.theme), settings: parseJson(form.settings), ...(form.responseCount === undefined ? {} : { responseCount: Number(form.responseCount) }), questions: questions.map(question => includeLogic ? publicQuestion(question) : respondentQuestion(question)) }; }
function responseData(result: any) { const answersByResponse = new Map<string, Record<string, unknown>>(); for (const answer of result.answers) { const values = answersByResponse.get(answer.responseId) ?? {}; try { values[answer.questionId] = answer.value ? JSON.parse(answer.value) : null; } catch { values[answer.questionId] = answer.value; } answersByResponse.set(answer.responseId, values); } return answersByResponse; }

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.appUser ? publicAccount(ctx.appUser) : null),
    googleEnabled: publicProcedure.query(() => ({ enabled: googleConfiguration(), message: googleConfiguration() ? "Google sign-in is configured." : "Google sign-in is unavailable until Google credentials are configured." })),
    passwordResetEnabled: publicProcedure.query(() => ({ enabled: passwordResetIsConfigured() })),
    signup: publicProcedure.input(accountInput).mutation(async ({ input, ctx }) => { try { const account = await signupAccount(input.name, input.email, input.password); const session = await createAppSession(account.id); setAppCookie(ctx.res, session.token, session.expiresAt); return publicAccount(account); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to create account." }); } }),
    login: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(1).max(200) })).mutation(async ({ input, ctx }) => { try { const account = await loginAccount(input.email, input.password); const session = await createAppSession(account.id); setAppCookie(ctx.res, session.token, session.expiresAt); return publicAccount(account); } catch (error) { throw new TRPCError({ code: "UNAUTHORIZED", message: error instanceof Error ? error.message : "Invalid email or password." }); } }),
    requestPasswordReset: publicProcedure.input(z.object({ email: z.string().trim().email().max(320) })).mutation(async ({ input }) => {
      if (!passwordResetIsConfigured()) {
        return { status: "unavailable" as const, message: "Password recovery is temporarily unavailable." };
      }
      const account = await getAccountByEmail(normalizeEmail(input.email));
      if (account?.passwordHash) {
        const reset = createPasswordResetTokenPair();
        const now = new Date();
        const created = await createPasswordResetToken(account.id, reset.tokenHash, passwordResetExpiresAt(now), now);
        if (created) {
          try {
            await sendPasswordResetEmail(account.email, passwordResetLink(reset.token));
          } catch (error) {
            console.error("[CoForms auth] Password reset email delivery failed.", error instanceof Error ? error.message : "Unknown error.");
            await invalidatePasswordResetToken(reset.tokenHash, now);
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to send a password reset email right now." });
          }
        }
      }
      return { status: "accepted" as const, message: "If an account uses this email, reset instructions will be sent." };
    }),
    resetPassword: publicProcedure.input(z.object({ token: z.string().min(40).max(64), password: z.string().min(12).max(200) })).mutation(async ({ input }) => {
      const tokenHash = hashPasswordResetToken(input.token);
      if (!(await isPasswordResetTokenValid(tokenHash))) throw new TRPCError({ code: "BAD_REQUEST", message: "This password reset link is invalid or expired. Request a new link." });
      const updated = await consumePasswordResetToken(tokenHash, await hashPassword(input.password));
      if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "This password reset link is invalid or expired. Request a new link." });
      return { success: true as const };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => { if (ctx.appSessionToken) { await revokeAppSession(ctx.appSessionToken); } const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); ctx.res.clearCookie(SPACEFORM_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  forms: router({
    list: protectedProcedure.query(({ ctx }) => listFormsForAccount(ctx.appUser.id)),
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(255), description: z.string().max(5000).optional() })).mutation(({ ctx, input }) => createForm(ctx.appUser.id, input.title, input.description)),
    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => { const form = await getFormForAccount(input.id, ctx.appUser.id); if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." }); return publicForm(form, await getQuestions(form.id)); }),
    update: protectedProcedure.input(formUpdateInput).mutation(async ({ ctx, input }) => {
      const normalized = { ...input, questions: input.questions.map(question => ({ ...question, type: question.type === "hidden" ? "hidden_field" : question.type, label: question.label ?? question.title ?? "", settings: { ...(question.settings ?? {}), ...(question.options ? { options: question.options } : {}) }, logic: question.logic ? { ...question.logic, questionId: question.logic.questionId ?? question.logic.whenQuestionId } : null })) };
      const owned = await getFormForAccount(input.id, ctx.appUser.id);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." });
      if (editRequiresUnpublishForPayment(owned.status, normalized.questions)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Unpublish this form before adding a payment question. Payment processing is not configured." });
      const form = await updateForm(input.id, ctx.appUser.id, normalized);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." });
      return publicForm(form, await getQuestions(form.id));
    }),
    setPublished: protectedProcedure.input(z.object({ id: z.string().uuid(), published: z.boolean() })).mutation(async ({ ctx, input }) => {
      const owned = await getFormForAccount(input.id, ctx.appUser.id);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." });
      const questions = await getQuestions(owned.id);
      if (input.published && questions.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one question before publishing." });
      if (input.published && questions.some(question => question.type === "payment")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payment questions cannot be published until a payment provider is connected." });
      const form = await setFormPublished(input.id, ctx.appUser.id, input.published);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." });
      return publicForm(form, await getQuestions(form.id));
    }),
    bySlug: publicProcedure.input(z.object({ slug: z.string().min(8).max(96).regex(/^[a-z0-9-]+$/) })).query(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." });
      return publicForm(form, await getQuestions(form.id), false);
    }),
    start: publicProcedure.input(z.object({ slug: z.string().min(8).max(96).regex(/^[a-z0-9-]+$/) })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." });
      return startFormResponse(form.id);
    }),
    progress: publicProcedure.input(z.object({ slug: z.string().min(8).max(96), responseId: z.string().uuid(), progressToken: z.string().min(32).max(100), questionId: z.string().uuid() })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." });
      const recorded = await recordResponseQuestionView({ formId: form.id, responseId: input.responseId, progressToken: input.progressToken, questionId: input.questionId });
      if (!recorded) throw new TRPCError({ code: "BAD_REQUEST", message: "This response session is no longer active." });
      return { success: true };
    }),
    visible: publicProcedure.input(z.object({ slug: z.string().min(8).max(96), answers: answersSchema })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." });
      const questions = await getQuestions(form.id);
      const normalizedQuestions = questions.map(question => ({ ...question, required: Boolean(question.required), settings: parseJson(question.settings) ?? {}, logic: parseJson(question.logic) }));
      const result = validateQuestionAnswers(normalizedQuestions as any, input.answers);
      return { questionIds: Array.from(result.visibleQuestionIds) };
    }),
    prepareUpload: publicProcedure.input(z.object({ slug: z.string().min(8).max(96), questionId: z.string().uuid(), fileName: z.string().min(1).max(255), mimeType: z.string().min(1).max(160), size: z.number().int().positive() })).mutation(async ({ input }) => { const form = await getPublishedFormBySlug(input.slug); if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." }); const question = (await getQuestions(form.id)).find(item => item.id === input.questionId); if (!question || question.type !== "file_upload") throw new TRPCError({ code: "BAD_REQUEST", message: "This question does not accept files." }); try { return await preparePublicUpload({ formId: form.id, questionId: question.id, fileName: input.fileName, mimeType: input.mimeType, size: input.size }); } catch (error) { throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Uploads are unavailable." }); } }),
    submit: publicProcedure.input(z.object({ slug: z.string().min(8).max(96), responseId: z.string().uuid(), progressToken: z.string().min(32).max(100), answers: answersSchema })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." });
      const questions = await getQuestions(form.id);
      const normalizedQuestions = questions.map(question => ({ ...question, required: Boolean(question.required), settings: parseJson(question.settings) ?? {}, logic: parseJson(question.logic) }));
      const validation = validateQuestionAnswers(normalizedQuestions as any, input.answers);
      if (!validation.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Please review the answers and try again.", cause: validation.errors });
      const visible = validation.visibleQuestionIds;
      const answerRows = Object.entries(input.answers).filter(([questionId]) => visible.has(questionId)).map(([questionId, value]) => ({ questionId, value }));
      const uploadedPaths: string[] = [];
      for (const question of questions) {
        if (question.type !== "file_upload" || !visible.has(question.id)) continue;
        const value = input.answers[question.id];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const assetPath = (value as Record<string, unknown>).path;
        if (typeof assetPath !== "string") continue;
        const upload = await getPublicUploadForQuestion(form.id, question.id, assetPath);
        if (!upload) throw new TRPCError({ code: "BAD_REQUEST", message: "This file does not belong to the selected question. Please upload it again." });
        uploadedPaths.push(assetPath);
      }
      const completed = await completeFormResponse({ formId: form.id, responseId: input.responseId, progressToken: input.progressToken, answers: answerRows });
      if (!completed) throw new TRPCError({ code: "BAD_REQUEST", message: "This response session has expired or was already submitted." });
      await bindPublicUploadsToResponse(form.id, input.responseId, uploadedPaths);
      const redirectCandidate = parseJson(form.settings)?.redirectUrl;
      return { responseId: input.responseId, status: "submitted" as const, redirectUrl: typeof redirectCandidate === "string" && redirectCandidate ? redirectCandidate : null };
    }),
    interviewTurn: publicProcedure.input(z.object({
      slug: z.string().min(8).max(96).regex(/^[a-z0-9-]+$/),
      responseId: z.string().uuid(),
      progressToken: z.string().min(32).max(100),
      utterance: z.string().min(1).max(2000),
      currentAnswers: answersSchema,
      language: z.string().max(10).optional().default("en"),
    })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Published form not found." });

      const questions = await getQuestions(form.id);
      if (!questions.length) throw new TRPCError({ code: "BAD_REQUEST", message: "This form has no questions." });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is unavailable." });

      const responseRows = await db.select().from(sfResponses).where(and(eq(sfResponses.id, input.responseId), eq(sfResponses.formId, form.id), eq(sfResponses.status, "in_progress"))).limit(1);
      const response = responseRows[0];
      if (!response || !progressTokenMatches(response.metadata, input.progressToken)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired response session token." });
      }

      const normalizedQuestions = questions.map(question => ({
        ...question,
        required: Boolean(question.required),
        settings: parseJson(question.settings) ?? {},
        logic: parseJson(question.logic),
      }));
      const validation = validateQuestionAnswers(normalizedQuestions as any, input.currentAnswers);
      const visibleList = normalizedQuestions.filter(q => validation.visibleQuestionIds.has(q.id));

      const activeQuestion = visibleList.find(q => {
        const val = input.currentAnswers[q.id];
        return val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
      }) || visibleList[visibleList.length - 1];

      const remainingCount = visibleList.filter(q => {
        const val = input.currentAnswers[q.id];
        return val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
      }).length;

      const configuredOptions = (activeQuestion as any).options ?? (activeQuestion.settings as any)?.options;
      const options = Array.isArray(configuredOptions) ? configuredOptions.map(String) : [];

      const turn = await generateInterviewTurn({
        currentQuestion: {
          id: activeQuestion.id,
          type: activeQuestion.type,
          title: activeQuestion.label || (activeQuestion as any).title || "Question",
          description: activeQuestion.description,
          required: Boolean(activeQuestion.required),
          options,
          settings: activeQuestion.settings as Record<string, unknown>,
        },
        utterance: input.utterance,
        language: input.language,
        remainingQuestionCount: remainingCount,
      });

      let verifiedAnswer: { questionId: string; value: any; displayValue: string } | undefined = undefined;
      if (turn.proposedAnswer && !turn.clarificationNeeded) {
        const testAnswers = { ...input.currentAnswers, [activeQuestion.id]: turn.proposedAnswer.value };
        const testValidation = validateQuestionAnswers(normalizedQuestions as any, testAnswers);
        if (!testValidation.errors[activeQuestion.id]) {
          verifiedAnswer = {
            questionId: activeQuestion.id,
            value: turn.proposedAnswer.value,
            displayValue: turn.proposedAnswer.displayValue,
          };
        } else {
          turn.clarificationNeeded = true;
          turn.clarificationReason = testValidation.errors[activeQuestion.id];
          turn.assistantMessage = `${turn.assistantMessage} Could you clarify? ${testValidation.errors[activeQuestion.id]}`;
        }
      }

      const simulatedAnswers = verifiedAnswer
        ? { ...input.currentAnswers, [activeQuestion.id]: verifiedAnswer.value }
        : input.currentAnswers;
      const finalValidation = validateQuestionAnswers(normalizedQuestions as any, simulatedAnswers);

      return {
        assistantMessage: turn.assistantMessage,
        proposedAnswer: verifiedAnswer,
        clarificationNeeded: turn.clarificationNeeded,
        clarificationReason: turn.clarificationReason,
        activeQuestionId: activeQuestion.id,
        isComplete: finalValidation.ok,
      };
    }),
    // ── Sarvam AI: TTS proxy ─────────────────────────────────────────────
    sarvamTTS: publicProcedure.input(z.object({
      text: z.string().min(1).max(2000),
      language: z.string().max(10).optional().default("hi"),
      speaker: z.string().max(40).optional(),
    })).mutation(async ({ input }) => {
      const result = await sarvamTTS({ text: input.text, language: input.language, speaker: input.speaker });
      if ("error" in result) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return result; // { audioBase64: string }
    }),
    // ── Sarvam AI: STT proxy ─────────────────────────────────────────────
    sarvamSTT: publicProcedure.input(z.object({
      audioBase64: z.string().min(1).max(MAX_SARVAM_AUDIO_BASE64_LENGTH),
      mimeType: z.string().max(60).optional().default("audio/webm"),
      language: z.string().max(10).optional().default("hi"),
    })).mutation(async ({ input }) => {
      const buf = decodeSarvamAudio(input.audioBase64);
      const result = await sarvamSTT({ audioBuffer: buf, mimeType: input.mimeType, language: input.language });
      if ("error" in result) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      return result; // { transcript: string; language_code: string }
    }),
    responses: protectedProcedure.input(z.object({ formId: z.string().uuid() })).query(async ({ ctx, input }) => { const result = await listResponsesForAccount(input.formId, ctx.appUser.id); if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." }); const map = responseData(result); return { form: { id: result.form.id, title: result.form.title, slug: result.form.slug }, questions: (await getAllQuestions(input.formId)).map(publicQuestion), responses: result.responses.map(response => ({ id: response.id, status: response.status, submittedAt: response.submittedAt, answers: map.get(response.id) ?? {} })), metrics: { total: result.metrics.submitted, submitted: result.metrics.submitted, started: result.metrics.started, completionRate: result.metrics.started ? Math.round(result.metrics.submitted / result.metrics.started * 100) : 0, questionViews: result.metrics.questionViews } }; }),
    responsesCsv: protectedProcedure.input(z.object({ formId: z.string().uuid() })).query(async ({ ctx, input }) => { const result = await listResponsesForAccount(input.formId, ctx.appUser.id); if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found." }); const map = responseData(result); const questions = await getAllQuestions(input.formId); return responsesToCsv(result.responses.map(response => ({ submittedAt: response.submittedAt, answers: map.get(response.id) ?? {} })), questions.map(question => ({ id: question.id, label: question.label }))); }),
  }),
  ai: router({ generate: protectedProcedure.input(z.object({ prompt: z.string().trim().min(3).max(2000) })).mutation(async ({ input }) => { try { return await generateDraft(input.prompt); } catch (error) { throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "AI drafting failed. Try a manual draft instead." }); } }) }),
});
export type AppRouter = typeof appRouter;
