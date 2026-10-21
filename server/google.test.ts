import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { getGoogleRedirectUri, googleConfiguration } from "./auth";
import { registerSpaceFormGoogleRoutes } from "./google";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google OAuth redirect URI configuration", () => {
  it("requires an exact HTTPS callback URL outside local development", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "https://forms.example.com/api/auth/google/callback");

    expect(getGoogleRedirectUri()).toBe("https://forms.example.com/api/auth/google/callback");
    expect(googleConfiguration()).toBe(true);
  });

  it.each([
    "",
    "https://forms.example.com/",
    "https://forms.example.com/api/auth/google/callback?next=/dashboard",
    "http://forms.example.com/api/auth/google/callback",
    "not a URL",
  ])("rejects an invalid callback URL: %s", redirectUri => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", redirectUri);

    expect(getGoogleRedirectUri()).toBeNull();
    expect(googleConfiguration()).toBe(false);
  });

  it("uses the configured callback instead of forwarded host headers", async () => {
    const redirectUri = "https://forms.example.com/api/auth/google/callback";
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", redirectUri);

    const app = express();
    registerSpaceFormGoogleRoutes(app);
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/google`, {
        redirect: "manual",
        headers: {
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
        },
      });

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(location.searchParams.get("redirect_uri")).toBe(redirectUri);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
