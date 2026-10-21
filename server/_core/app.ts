import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerSpaceFormGoogleRoutes } from "../google";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";

export function createExpressApp(): Express {
  const app = express();

  // Normalize rewritten URLs in Vercel serverless environment
  app.use((req, _res, next) => {
    // 1. Explicit __route parameter injected by vercel.json rewrite
    if (req.url.includes("__route=")) {
      try {
        const parsed = new URL(req.url, "http://localhost");
        const route = parsed.searchParams.get("__route");
        if (route && route.startsWith("/api")) {
          parsed.searchParams.delete("__route");
          req.url = route + (parsed.search || "");
          return next();
        }
      } catch {
        // proceed to fallback
      }
    }

    // 2. Fallback to Vercel internal headers if present
    const forwarded = (req.headers["x-matched-path"] || req.headers["x-forwarded-uri"]) as string | undefined;
    if (forwarded && forwarded.startsWith("/api")) {
      const qIndex = req.url.indexOf("?");
      const query = qIndex !== -1 ? req.url.substring(qIndex) : "";
      req.url = forwarded.includes("?") ? forwarded : forwarded + query;
    }
    next();
  });

  // Configure body parser with limit for file uploads and audio payloads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  registerSpaceFormGoogleRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  return app;
}
