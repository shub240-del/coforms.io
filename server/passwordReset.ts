import { createHash, randomBytes } from "node:crypto";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

type ResendConfiguration = {
  apiKey: string;
  from: string;
  appOrigin: string;
};

export function createPasswordResetTokenPair() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashPasswordResetToken(token);
  return { token, tokenHash };
}

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function passwordResetExpiresAt(now = new Date()) {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS);
}

function getResendConfiguration(): ResendConfiguration | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const appUrl = process.env.PUBLIC_APP_URL?.trim();
  if (!apiKey || !from || /[\r\n]/.test(from) || !from.includes("@") || !appUrl) return null;

  try {
    const url = new URL(appUrl);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localHttp)) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) return null;
    return { apiKey, from, appOrigin: url.origin };
  } catch {
    return null;
  }
}

export function passwordResetIsConfigured() {
  return getResendConfiguration() !== null;
}

export function passwordResetLink(token: string) {
  const config = getResendConfiguration();
  if (!config) throw new Error("Password reset email delivery is not configured.");
  const url = new URL("/reset-password", config.appOrigin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  const config = getResendConfiguration();
  if (!config) throw new Error("Password reset email delivery is not configured.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [email],
      subject: "Reset your CoForms password",
      text: `Use this link to reset your CoForms password. It expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Use the link below to reset your CoForms password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!response.ok) throw new Error(`Resend email delivery failed with HTTP ${response.status}.`);
}
