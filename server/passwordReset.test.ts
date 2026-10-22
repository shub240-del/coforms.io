import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  createPasswordResetTokenPair,
  hashPasswordResetToken,
  passwordResetExpiresAt,
  passwordResetIsConfigured,
  passwordResetLink,
  sendPasswordResetEmail,
} from "./passwordReset";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configureResend() {
  vi.stubEnv("RESEND_API_KEY", "test-api-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "CoForms <noreply@example.com>");
  vi.stubEnv("PUBLIC_APP_URL", "https://forms.example.com");
  vi.stubEnv("NODE_ENV", "production");
}

const account = {
  id: "account-id",
  email: "person@example.com",
  name: "Sample Person",
  passwordHash: "scrypt$test$hash",
  provider: "password",
  providerSubject: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createCaller() {
  const context: TrpcContext = {
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
    appUser: null,
    appSessionToken: null,
  };
  return appRouter.createCaller(context);
}

describe("password reset email service", () => {
  it("creates opaque tokens and stores only a deterministic digest", () => {
    const first = createPasswordResetTokenPair();
    const second = createPasswordResetTokenPair();

    expect(first.token).toHaveLength(43);
    expect(first.token).not.toBe(first.tokenHash);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPasswordResetToken(first.token)).toBe(first.tokenHash);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it("expires reset links after 30 minutes", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(passwordResetExpiresAt(now).getTime() - now.getTime()).toBe(30 * 60 * 1000);
  });

  it("requires all provider and canonical URL settings before enabling recovery", () => {
    expect(passwordResetIsConfigured()).toBe(false);
    configureResend();
    expect(passwordResetIsConfigured()).toBe(true);

    vi.stubEnv("PUBLIC_APP_URL", "http://forms.example.com");
    expect(passwordResetIsConfigured()).toBe(false);
    vi.stubEnv("PUBLIC_APP_URL", "https://forms.example.com/path");
    expect(passwordResetIsConfigured()).toBe(false);
  });

  it("keeps reset tokens in the URL fragment and sends through Resend", async () => {
    configureResend();
    const token = createPasswordResetTokenPair().token;
    const link = passwordResetLink(token);
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe("https://forms.example.com/reset-password");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(token);

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendPasswordResetEmail("person@example.com", link);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(options.headers).toMatchObject({ authorization: "Bearer test-api-key" });
    expect(JSON.parse(String(options.body))).toMatchObject({
      from: "CoForms <noreply@example.com>",
      to: ["person@example.com"],
      subject: "Reset your CoForms password",
      text: expect.stringContaining(link),
      html: expect.stringContaining(link),
    });
  });

  it("surfaces Resend delivery failures", async () => {
    configureResend();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(sendPasswordResetEmail("person@example.com", "https://forms.example.com/reset-password"))
      .rejects.toThrow("Resend email delivery failed with HTTP 503.");
  });

  it("uses the same accepted response for unknown accounts without sending email", async () => {
    configureResend();
    vi.spyOn(database, "getAccountByEmail").mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCaller().auth.requestPasswordReset({ email: "unknown@example.com" });

    expect(result).toEqual({
      status: "accepted",
      message: "If an account uses this email, reset instructions will be sent.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores only the token digest and emails a reset link for an account", async () => {
    configureResend();
    vi.spyOn(database, "getAccountByEmail").mockResolvedValue(account);
    const createToken = vi.spyOn(database, "createPasswordResetToken").mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCaller().auth.requestPasswordReset({ email: " PERSON@example.com " });

    expect(result.status).toBe("accepted");
    expect(createToken).toHaveBeenCalledOnce();
    const [, tokenHash, expiresAt] = createToken.mock.calls[0] ?? [];
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(expiresAt?.getTime()).toBeGreaterThan(Date.now());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const mail = JSON.parse(String(options.body));
    const link = new URL(mail.text.match(/https:\/\/[^\s]+/)[0]);
    const token = new URLSearchParams(link.hash.slice(1)).get("token") ?? "";
    expect(token).toHaveLength(43);
    expect(tokenHash).toBe(hashPasswordResetToken(token));
  });

  it("rejects expired reset tokens without changing a password", async () => {
    const validToken = vi.spyOn(database, "isPasswordResetTokenValid").mockResolvedValue(false);
    const consumeToken = vi.spyOn(database, "consumePasswordResetToken");
    const token = createPasswordResetTokenPair().token;

    await expect(createCaller().auth.resetPassword({ token, password: "Long-enough-test-password" }))
      .rejects.toThrow("This password reset link is invalid or expired.");

    expect(validToken).toHaveBeenCalledOnce();
    expect(consumeToken).not.toHaveBeenCalled();
  });

  it("updates the password after validating a reset token", async () => {
    vi.spyOn(database, "isPasswordResetTokenValid").mockResolvedValue(true);
    const consumeToken = vi.spyOn(database, "consumePasswordResetToken").mockResolvedValue(true);
    const token = createPasswordResetTokenPair().token;

    await expect(createCaller().auth.resetPassword({ token, password: "Long-enough-test-password" }))
      .resolves.toEqual({ success: true });

    expect(consumeToken).toHaveBeenCalledOnce();
    expect(consumeToken.mock.calls[0]?.[0]).toBe(hashPasswordResetToken(token));
    expect(consumeToken.mock.calls[0]?.[1]).toMatch(/^scrypt\$/);
  });
});
