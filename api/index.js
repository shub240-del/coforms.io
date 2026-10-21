// server/_core/app.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "webdev_app_session";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import {
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var sfAccounts = mysqlTable("spaceform_accounts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  provider: varchar("provider", { length: 32 }).default("password").notNull(),
  providerSubject: varchar("providerSubject", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({ providerSubjectUnique: uniqueIndex("spaceform_accounts_provider_subject_unique").on(table.provider, table.providerSubject) }));
var sfSessions = mysqlTable("spaceform_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  accountId: varchar("accountId", { length: 36 }).notNull().references(() => sfAccounts.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt")
}, (table) => ({ accountIdx: index("spaceform_sessions_account_idx").on(table.accountId) }));
var sfWorkspaces = mysqlTable("spaceform_workspaces", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerAccountId: varchar("ownerAccountId", { length: 36 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  ownerIdx: index("spaceform_workspaces_owner_idx").on(table.ownerAccountId),
  ownerFk: foreignKey({ name: "sf_workspace_owner_fk", columns: [table.ownerAccountId], foreignColumns: [sfAccounts.id] }).onDelete("cascade")
}));
var sfWorkspaceMembers = mysqlTable("spaceform_workspace_members", {
  workspaceId: varchar("workspaceId", { length: 36 }).notNull(),
  accountId: varchar("accountId", { length: 36 }).notNull(),
  role: mysqlEnum("role", ["owner", "editor", "viewer"]).default("viewer").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  memberPk: primaryKey({ columns: [table.workspaceId, table.accountId] }),
  workspaceFk: foreignKey({ name: "sf_member_workspace_fk", columns: [table.workspaceId], foreignColumns: [sfWorkspaces.id] }).onDelete("cascade"),
  accountFk: foreignKey({ name: "sf_member_account_fk", columns: [table.accountId], foreignColumns: [sfAccounts.id] }).onDelete("cascade")
}));
var sfForms = mysqlTable("spaceform_forms", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workspaceId: varchar("workspaceId", { length: 36 }).notNull().references(() => sfWorkspaces.id, { onDelete: "cascade" }),
  ownerAccountId: varchar("ownerAccountId", { length: 36 }).notNull().references(() => sfAccounts.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  slug: varchar("slug", { length: 96 }).notNull().unique(),
  status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(),
  theme: text("theme"),
  settings: text("settings"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  publishedAt: timestamp("publishedAt")
}, (table) => ({ workspaceIdx: index("spaceform_forms_workspace_idx").on(table.workspaceId), ownerIdx: index("spaceform_forms_owner_idx").on(table.ownerAccountId) }));
var sfQuestions = mysqlTable("spaceform_questions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  formId: varchar("formId", { length: 36 }).notNull().references(() => sfForms.id, { onDelete: "cascade" }),
  position: int("position").notNull(),
  type: varchar("type", { length: 48 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  description: text("description"),
  required: int("required").default(0).notNull(),
  archived: int("archived").default(0).notNull(),
  settings: text("settings"),
  logic: text("logic"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({ formPositionIdx: index("spaceform_questions_form_position_idx").on(table.formId, table.position) }));
var sfResponses = mysqlTable("spaceform_responses", {
  id: varchar("id", { length: 36 }).primaryKey(),
  formId: varchar("formId", { length: 36 }).notNull().references(() => sfForms.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["in_progress", "submitted"]).default("submitted").notNull(),
  respondentEmail: varchar("respondentEmail", { length: 320 }),
  metadata: text("metadata"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  submittedAt: timestamp("submittedAt")
}, (table) => ({ formSubmittedIdx: index("spaceform_responses_form_submitted_idx").on(table.formId, table.submittedAt) }));
var sfAnswers = mysqlTable("spaceform_answers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  responseId: varchar("responseId", { length: 36 }).notNull().references(() => sfResponses.id, { onDelete: "cascade" }),
  questionId: varchar("questionId", { length: 36 }).notNull().references(() => sfQuestions.id, { onDelete: "cascade" }),
  value: text("value"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({ responseQuestionUnique: uniqueIndex("spaceform_answers_response_question_unique").on(table.responseId, table.questionId), questionIdx: index("spaceform_answers_question_idx").on(table.questionId) }));
var sfResponseEvents = mysqlTable("spaceform_response_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  responseId: varchar("responseId", { length: 36 }).notNull().references(() => sfResponses.id, { onDelete: "cascade" }),
  questionId: varchar("questionId", { length: 36 }).references(() => sfQuestions.id, { onDelete: "set null" }),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({ responseIdx: index("spaceform_response_events_response_idx").on(table.responseId) }));
var sfUploads = mysqlTable("spaceform_uploads", {
  id: varchar("id", { length: 36 }).primaryKey(),
  accountId: varchar("accountId", { length: 36 }).references(() => sfAccounts.id, { onDelete: "set null" }),
  formId: varchar("formId", { length: 36 }).references(() => sfForms.id, { onDelete: "set null" }),
  responseId: varchar("responseId", { length: 36 }).references(() => sfResponses.id, { onDelete: "set null" }),
  key: varchar("key", { length: 512 }).notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  contentType: varchar("contentType", { length: 160 }),
  byteSize: int("byteSize"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({ accountIdx: index("spaceform_uploads_account_idx").on(table.accountId), formIdx: index("spaceform_uploads_form_idx").on(table.formId), responseIdx: index("spaceform_uploads_response_idx").on(table.responseId) }));

// server/_core/env.ts
var ENV = {
  get appId() {
    return process.env.MANUS_PROJECT_ID ?? "";
  },
  get cookieSecret() {
    return process.env.MANUS_JWT_SECRET ?? "";
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  get oAuthServerUrl() {
    return process.env.MANUS_OAUTH_API_URL ?? "";
  },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() {
    return process.env.OWNER_OPEN_ID ?? "";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get forgeApiUrl() {
    return process.env.MANUS_API_URL || (process.env.NVIDIA_API_KEY ? "https://integrate.api.nvidia.com/v1" : "");
  },
  get forgeApiKey() {
    return process.env.MANUS_API_KEY || process.env.NVIDIA_API_KEY || "";
  },
  get sakanaApiKey() {
    return process.env.SAKANA_API_KEY ?? "";
  }
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) _db = drizzle(process.env.DATABASE_URL);
  return _db;
}
function requireDb() {
  if (!_db && process.env.DATABASE_URL) _db = drizzle(process.env.DATABASE_URL);
  if (!_db) throw new Error("Database is not available");
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const updateSet = { lastSignedIn: user.lastSignedIn ?? /* @__PURE__ */ new Date() };
  for (const field of ["name", "email", "loginMethod"]) if (user[field] !== void 0) updateSet[field] = user[field] ?? null;
  if (user.role !== void 0) updateSet.role = user.role;
  else if (user.openId === ENV.ownerOpenId) updateSet.role = "admin";
  await db.insert(users).values({ openId: user.openId, name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, role: user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"), lastSignedIn: user.lastSignedIn ?? /* @__PURE__ */ new Date() }).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return rows[0];
}
async function insertAccount(account) {
  const db = requireDb();
  await db.insert(sfAccounts).values(account);
  const rows = await db.select().from(sfAccounts).where(eq(sfAccounts.id, account.id)).limit(1);
  if (!rows[0]) throw new Error("Account insert failed");
  return rows[0];
}
async function getAccountByEmail(email) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(sfAccounts).where(eq(sfAccounts.email, email)).limit(1);
  return rows[0];
}
async function getAccountByProviderSubject(provider, providerSubject) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select().from(sfAccounts).where(and(eq(sfAccounts.provider, provider), eq(sfAccounts.providerSubject, providerSubject))).limit(1);
  return rows[0];
}
async function upsertGoogleAccount(input) {
  const existing = await getAccountByProviderSubject("google", input.subject);
  if (existing) return existing;
  const byEmail = await getAccountByEmail(input.email);
  if (byEmail) return byEmail;
  return insertAccount({ id: crypto.randomUUID(), email: input.email, name: input.name, passwordHash: null, provider: "google", providerSubject: input.subject });
}
async function insertSession(session) {
  const db = requireDb();
  await db.insert(sfSessions).values(session);
}
async function getAccountBySessionHash(tokenHash) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const rows = await db.select({ account: sfAccounts, session: sfSessions }).from(sfSessions).innerJoin(sfAccounts, eq(sfSessions.accountId, sfAccounts.id)).where(and(eq(sfSessions.tokenHash, tokenHash), isNull(sfSessions.revokedAt))).limit(1);
  const row = rows[0];
  return row && row.session.expiresAt > /* @__PURE__ */ new Date() ? row.account : void 0;
}
async function revokeSessionByHash(tokenHash) {
  const db = requireDb();
  await db.update(sfSessions).set({ revokedAt: /* @__PURE__ */ new Date() }).where(eq(sfSessions.tokenHash, tokenHash));
}
async function ensureWorkspaceForAccount(accountId) {
  const db = requireDb();
  const existing = await db.select().from(sfWorkspaces).where(eq(sfWorkspaces.ownerAccountId, accountId)).limit(1);
  if (existing[0]) return existing[0];
  const workspace = { id: crypto.randomUUID(), ownerAccountId: accountId, name: "Personal workspace" };
  await db.insert(sfWorkspaces).values(workspace);
  await db.insert(sfWorkspaceMembers).values({ workspaceId: workspace.id, accountId, role: "owner" });
  return (await db.select().from(sfWorkspaces).where(eq(sfWorkspaces.id, workspace.id)).limit(1))[0];
}
async function getOwnedWorkspace(accountId) {
  const db = requireDb();
  const rows = await db.select({ workspace: sfWorkspaces }).from(sfWorkspaces).leftJoin(sfWorkspaceMembers, eq(sfWorkspaces.id, sfWorkspaceMembers.workspaceId)).where(and(eq(sfWorkspaceMembers.accountId, accountId), eq(sfWorkspaceMembers.role, "owner"))).limit(1);
  return rows[0]?.workspace ?? (await db.select().from(sfWorkspaces).where(eq(sfWorkspaces.ownerAccountId, accountId)).limit(1))[0];
}
async function listFormsForAccount(accountId) {
  const db = requireDb();
  const forms = await db.select().from(sfForms).where(eq(sfForms.ownerAccountId, accountId)).orderBy(desc(sfForms.updatedAt));
  if (!forms.length) return [];
  const counts = await db.select({ formId: sfResponses.formId, responseCount: sql`count(*)` }).from(sfResponses).innerJoin(sfForms, eq(sfForms.id, sfResponses.formId)).where(and(eq(sfForms.ownerAccountId, accountId), eq(sfResponses.status, "submitted"))).groupBy(sfResponses.formId);
  const countByForm = new Map(counts.map((row) => [row.formId, Number(row.responseCount)]));
  return forms.map((form) => ({ ...form, responseCount: countByForm.get(form.id) ?? 0 }));
}
async function getFormForAccount(id, accountId) {
  const db = requireDb();
  const rows = await db.select().from(sfForms).where(and(eq(sfForms.id, id), eq(sfForms.ownerAccountId, accountId))).limit(1);
  if (!rows[0]) return void 0;
  const totals = await db.select({ responseCount: sql`count(*)` }).from(sfResponses).where(and(eq(sfResponses.formId, id), eq(sfResponses.status, "submitted")));
  return { ...rows[0], responseCount: Number(totals[0]?.responseCount ?? 0) };
}
async function getPublishedFormBySlug(slug) {
  const db = requireDb();
  const rows = await db.select().from(sfForms).where(and(eq(sfForms.slug, slug), eq(sfForms.status, "published"))).limit(1);
  return rows[0];
}
async function getQuestions(formId) {
  const db = requireDb();
  return db.select().from(sfQuestions).where(and(eq(sfQuestions.formId, formId), eq(sfQuestions.archived, 0))).orderBy(asc(sfQuestions.position));
}
async function getAllQuestions(formId) {
  const db = requireDb();
  return db.select().from(sfQuestions).where(eq(sfQuestions.formId, formId)).orderBy(asc(sfQuestions.position));
}
async function createForm(accountId, title, description) {
  const db = requireDb();
  const workspace = await getOwnedWorkspace(accountId);
  if (!workspace) throw new Error("Workspace not found");
  const id = crypto.randomUUID();
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await db.insert(sfForms).values({ id, workspaceId: workspace.id, ownerAccountId: accountId, title: title.trim(), description: description ?? null, slug, theme: JSON.stringify({ accent: "#f2c84b", background: "#f7f4ed", font: "sans" }), settings: JSON.stringify({}), status: "draft" });
  return getFormForAccount(id, accountId);
}
async function updateForm(id, accountId, patch) {
  const db = requireDb();
  const saved = await db.transaction(async (tx) => {
    const owned = await tx.select().from(sfForms).where(and(eq(sfForms.id, id), eq(sfForms.ownerAccountId, accountId))).limit(1);
    if (!owned[0]) return false;
    await tx.update(sfForms).set({ title: patch.title.trim(), description: patch.description ?? null, theme: patch.theme ? JSON.stringify(patch.theme) : owned[0].theme, settings: patch.settings ? JSON.stringify(patch.settings) : owned[0].settings }).where(eq(sfForms.id, id));
    const activeQuestions = await tx.select({ id: sfQuestions.id }).from(sfQuestions).where(and(eq(sfQuestions.formId, id), eq(sfQuestions.archived, 0)));
    const retained = /* @__PURE__ */ new Set();
    for (const [position, question] of patch.questions.entries()) {
      const questionId = question.id ?? crypto.randomUUID();
      const values = { formId: id, position, type: question.type, label: question.label, description: question.description ?? null, required: question.required ? 1 : 0, settings: JSON.stringify(question.settings ?? {}), logic: question.logic ? JSON.stringify(question.logic) : null, archived: 0 };
      const existing = await tx.select({ id: sfQuestions.id }).from(sfQuestions).where(and(eq(sfQuestions.id, questionId), eq(sfQuestions.formId, id))).limit(1);
      if (existing[0]) await tx.update(sfQuestions).set(values).where(and(eq(sfQuestions.id, questionId), eq(sfQuestions.formId, id)));
      else await tx.insert(sfQuestions).values({ id: questionId, ...values });
      retained.add(questionId);
    }
    for (const question of activeQuestions) if (!retained.has(question.id)) await tx.update(sfQuestions).set({ archived: 1 }).where(and(eq(sfQuestions.id, question.id), eq(sfQuestions.formId, id)));
    return true;
  });
  return saved ? getFormForAccount(id, accountId) : void 0;
}
async function setFormPublished(id, accountId, published) {
  const db = requireDb();
  await db.update(sfForms).set({ status: published ? "published" : "draft", publishedAt: published ? /* @__PURE__ */ new Date() : null }).where(and(eq(sfForms.id, id), eq(sfForms.ownerAccountId, accountId)));
  return getFormForAccount(id, accountId);
}
async function listResponsesForAccount(formId, accountId) {
  const db = requireDb();
  const form = await getFormForAccount(formId, accountId);
  if (!form) return void 0;
  const allResponses = await db.select().from(sfResponses).where(eq(sfResponses.formId, formId)).orderBy(desc(sfResponses.startedAt));
  const responses = allResponses.filter((response) => response.status === "submitted");
  const answers = responses.length ? await db.select().from(sfAnswers).where(inArray(sfAnswers.responseId, responses.map((response) => response.id))) : [];
  const events = allResponses.length ? await db.select().from(sfResponseEvents).where(inArray(sfResponseEvents.responseId, allResponses.map((response) => response.id))) : [];
  const views = /* @__PURE__ */ new Map();
  for (const event of events) if (event.eventType === "question_view" && event.questionId) {
    const respondents = views.get(event.questionId) ?? /* @__PURE__ */ new Set();
    respondents.add(event.responseId);
    views.set(event.questionId, respondents);
  }
  return { form, responses, answers, metrics: { started: allResponses.length, submitted: responses.length, questionViews: Array.from(views, ([questionId, respondentIds]) => ({ questionId, count: respondentIds.size })) } };
}
async function insertUpload(upload) {
  const db = requireDb();
  await db.insert(sfUploads).values(upload);
  return upload;
}
async function getPublicUploadForQuestion(formId, questionId, assetPath) {
  const db = requireDb();
  const rows = await db.select().from(sfUploads).where(and(eq(sfUploads.formId, formId), eq(sfUploads.url, assetPath), isNull(sfUploads.responseId))).limit(1);
  const upload = rows[0];
  if (!upload || !upload.key.includes(`/questions/${questionId}/`)) return void 0;
  return upload;
}
async function bindPublicUploadsToResponse(formId, responseId, assetPaths) {
  if (!assetPaths.length) return;
  const db = requireDb();
  await db.update(sfUploads).set({ responseId }).where(and(eq(sfUploads.formId, formId), isNull(sfUploads.responseId), inArray(sfUploads.url, assetPaths)));
}
function hashProgressToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function progressTokenMatches(metadata, token) {
  if (!metadata || !token) return false;
  try {
    const saved = JSON.parse(metadata);
    const expected = typeof saved.progressTokenHash === "string" ? saved.progressTokenHash : "";
    const actual = hashProgressToken(token);
    return expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}
async function startFormResponse(formId) {
  const db = requireDb();
  const responseId = crypto.randomUUID();
  const progressToken = randomBytes(32).toString("base64url");
  await db.insert(sfResponses).values({ id: responseId, formId, status: "in_progress", metadata: JSON.stringify({ progressTokenHash: hashProgressToken(progressToken) }), startedAt: /* @__PURE__ */ new Date(), submittedAt: null });
  return { responseId, progressToken };
}
async function recordResponseQuestionView(input) {
  const db = requireDb();
  const response = await db.select().from(sfResponses).where(and(eq(sfResponses.id, input.responseId), eq(sfResponses.formId, input.formId), eq(sfResponses.status, "in_progress"))).limit(1);
  if (!response[0] || !progressTokenMatches(response[0].metadata, input.progressToken)) return false;
  const question = await db.select({ id: sfQuestions.id }).from(sfQuestions).where(and(eq(sfQuestions.id, input.questionId), eq(sfQuestions.formId, input.formId), eq(sfQuestions.archived, 0))).limit(1);
  if (!question[0]) return false;
  await db.insert(sfResponseEvents).values({ id: crypto.randomUUID(), responseId: input.responseId, questionId: input.questionId, eventType: "question_view", metadata: null });
  return true;
}
async function completeFormResponse(input) {
  const db = requireDb();
  return db.transaction(async (tx) => {
    const response = await tx.select().from(sfResponses).where(and(eq(sfResponses.id, input.responseId), eq(sfResponses.formId, input.formId), eq(sfResponses.status, "in_progress"))).limit(1);
    if (!response[0] || !progressTokenMatches(response[0].metadata, input.progressToken)) return false;
    await tx.update(sfResponses).set({ status: "submitted", submittedAt: /* @__PURE__ */ new Date() }).where(and(eq(sfResponses.id, input.responseId), eq(sfResponses.formId, input.formId), eq(sfResponses.status, "in_progress")));
    if (input.answers.length) await tx.insert(sfAnswers).values(input.answers.map((answer) => ({ id: crypto.randomUUID(), responseId: input.responseId, questionId: answer.questionId, value: JSON.stringify(answer.value) })));
    return true;
  });
}

// server/_core/cookies.ts
function getSessionCookieOptions(_req) {
  return { httpOnly: true, path: "/", sameSite: "none", secure: true };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: MANUS_OAUTH_API_URL is not configured! Set MANUS_OAUTH_API_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) throw new Error("MANUS_JWT_SECRET is unavailable");
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || (!isNonEmptyString(appId) || appId !== ENV.appId) || typeof name !== "string") {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken && req.path.startsWith("/api/scheduled/")) {
      const ticket = cookies.get("app_session_id");
      const identity = await this.verifySession(ticket);
      if (identity?.openId.startsWith(CRON_OPEN_ID_PREFIX)) sessionToken = ticket;
    }
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/google.ts
import { randomBytes as randomBytes3, timingSafeEqual as timingSafeEqual3 } from "node:crypto";
import { parse } from "cookie";

// server/auth.ts
import { promisify } from "node:util";
import { randomBytes as randomBytes2, randomUUID, scrypt as nodeScrypt, timingSafeEqual as timingSafeEqual2, createHash as createHash2 } from "node:crypto";
import { parse as parseCookie } from "cookie";
var scrypt = promisify(nodeScrypt);
var SPACEFORM_SESSION_COOKIE = "spaceform_session";
var SESSION_TTL_MS = 1e3 * 60 * 60 * 24 * 30;
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
async function hashPassword(password) {
  if (password.length < 12 || password.length > 200) throw new Error("Password must be at least 12 characters.");
  const salt = randomBytes2(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  if (!encoded?.startsWith("scrypt$")) return false;
  const [, salt, expectedHex] = encoded.split("$");
  if (!salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual2(expected, actual);
}
function hashSessionToken(token) {
  return createHash2("sha256").update(token).digest("hex");
}
function newOpaqueSessionToken() {
  return randomBytes2(32).toString("base64url");
}
function publicAccount(account) {
  return { id: account.id, name: account.name, email: account.email, loginMethod: account.provider, role: "user", createdAt: account.createdAt, updatedAt: account.updatedAt, lastSignedIn: account.updatedAt };
}
async function signupAccount(name, email, password) {
  const normalized = normalizeEmail(email);
  const existing = await getAccountByEmail(normalized);
  if (existing) throw new Error("An account with this email already exists.");
  const account = await insertAccount({ id: randomUUID(), name: name.trim(), email: normalized, passwordHash: await hashPassword(password), provider: "password" });
  await ensureWorkspaceForAccount(account.id);
  return account;
}
async function loginAccount(email, password) {
  const account = await getAccountByEmail(normalizeEmail(email));
  if (!account || !await verifyPassword(password, account.passwordHash)) throw new Error("Invalid email or password.");
  return account;
}
async function createAppSession(accountId) {
  const token = newOpaqueSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await insertSession({ id: randomUUID(), accountId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}
async function accountFromRequest(req) {
  const token = parseCookie(req.headers.cookie ?? "")[SPACEFORM_SESSION_COOKIE];
  if (!token) return null;
  const account = await getAccountBySessionHash(hashSessionToken(token));
  return account ? { account, token } : null;
}
async function revokeAppSession(token) {
  await revokeSessionByHash(hashSessionToken(token));
}
function googleConfiguration() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// server/google.ts
var STATE_COOKIE = "spaceform_google_state";
var NONCE_COOKIE = "spaceform_google_nonce";
function getRedirectUri(req) {
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(",")[0].trim();
  const proto = (req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http")).toString().split(",")[0].trim();
  if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
    return `${proto}://${host}/api/auth/google/callback`;
  }
  return process.env.GOOGLE_REDIRECT_URI || `${proto}://${host || "localhost:3000"}/api/auth/google/callback`;
}
function config(req) {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: req ? getRedirectUri(req) : process.env.GOOGLE_REDIRECT_URI ?? ""
  };
}
function clearOAuthCookies(res, req) {
  const options = { ...getSessionCookieOptions(req), maxAge: 0 };
  res.clearCookie(STATE_COOKIE, options);
  res.clearCookie(NONCE_COOKIE, options);
}
function constantTimeMatch(expected, actual) {
  if (!expected || !actual || expected.length !== actual.length) return false;
  return timingSafeEqual3(Buffer.from(expected), Buffer.from(actual));
}
function registerSpaceFormGoogleRoutes(app2) {
  app2.get("/api/auth/google", (req, res) => {
    if (!googleConfiguration()) {
      res.status(503).json({ error: "Google sign-in is unavailable until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured." });
      return;
    }
    const state = randomBytes3(24).toString("base64url");
    const nonce = randomBytes3(24).toString("base64url");
    const options = { ...getSessionCookieOptions(req), maxAge: 6e5 };
    res.cookie(STATE_COOKIE, state, options);
    res.cookie(NONCE_COOKIE, nonce, options);
    const { clientId, redirectUri } = config(req);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("access_type", "online");
    res.redirect(url.toString());
  });
  app2.get("/api/auth/google/callback", async (req, res) => {
    if (!googleConfiguration()) {
      res.status(503).json({ error: "Google sign-in is not configured." });
      return;
    }
    const cookies = parse(req.headers.cookie ?? "");
    const expectedState = cookies[STATE_COOKIE] ?? "";
    const expectedNonce = cookies[NONCE_COOKIE] ?? "";
    const returnedState = typeof req.query.state === "string" ? req.query.state : "";
    if (!constantTimeMatch(expectedState, returnedState)) {
      clearOAuthCookies(res, req);
      res.status(400).json({ error: "Invalid Google OAuth state." });
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      clearOAuthCookies(res, req);
      res.status(400).json({ error: "Google did not return an authorization code." });
      return;
    }
    clearOAuthCookies(res, req);
    try {
      const { clientId, clientSecret, redirectUri } = config(req);
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
      });
      const token = await tokenResponse.json();
      if (!tokenResponse.ok || !token.access_token || !token.id_token) throw new Error(token.error || "Google token exchange failed.");
      const verifyResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`);
      const claims = await verifyResponse.json();
      const validIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
      if (!verifyResponse.ok || claims.aud !== clientId || !validIssuer || !claims.sub || !constantTimeMatch(expectedNonce, claims.nonce ?? "")) {
        throw new Error(claims.error_description || "Google returned an invalid identity token.");
      }
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
      const profile = await profileResponse.json();
      if (!profileResponse.ok || profile.sub !== claims.sub || !profile.email || profile.email_verified !== true) throw new Error("Google returned an unusable account.");
      const account = await upsertGoogleAccount({ subject: profile.sub, email: profile.email.trim().toLowerCase(), name: profile.name?.trim() || profile.email });
      await ensureWorkspaceForAccount(account.id);
      const session = await createAppSession(account.id);
      res.cookie(SPACEFORM_SESSION_COOKIE, session.token, { ...getSessionCookieOptions(req), maxAge: session.expiresAt.getTime() - Date.now() });
      res.redirect("/dashboard");
    } catch (error) {
      console.error("[CoForms Google OAuth] callback failed:", error);
      res.status(502).json({ error: "Google sign-in could not be completed. Try email sign-in instead." });
    }
  });
}

// server/_core/publicConfig.ts
function publicPlatformConfig(env = process.env) {
  return {
    projectId: env.MANUS_PROJECT_ID ?? "",
    oauthPortalUrl: env.MANUS_OAUTH_PORTAL_URL ?? "",
    apiUrl: env.MANUS_API_URL ?? "",
    apiBrowserKey: env.MANUS_API_BROWSER_KEY ?? ""
  };
}
function publicPlatformScript(env = process.env) {
  const json = JSON.stringify(publicPlatformConfig(env)).replaceAll("<", "\\u003c");
  return `window.__MANUS_CONFIG__=${json};`;
}

// server/routers.ts
import { and as and2, eq as eq2 } from "drizzle-orm";
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z3 } from "zod";

// server/_core/llm.ts
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var platformApiBase = () => {
  if (!ENV.forgeApiUrl.trim()) throw new Error("MANUS_API_URL is not configured");
  return ENV.forgeApiUrl.replace(/\/$/, "");
};
var resolveApiUrl = () => {
  const base = platformApiBase();
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
};
var assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("MANUS_API_KEY is not configured");
  }
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
var RETRY_MAX_RETRIES = 4;
var RETRY_BASE_DELAY_MS = 500;
var RETRY_MAX_DELAY_MS = 3e4;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var parseRetryAfter = (value) => {
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
  const at = Date.parse(value);
  return Number.isNaN(at) ? void 0 : Math.max(0, at - Date.now());
};
var computeBackoffDelay = (attempt, retryAfterMs) => {
  const cap = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  const jittered = cap / 2 + Math.random() * (cap / 2);
  return Math.min(Math.max(jittered, retryAfterMs ?? 0), RETRY_MAX_DELAY_MS);
};
var fetchWithBackoff = async (url, init) => {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === RETRY_MAX_RETRIES) {
        return response;
      }
      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after")
      );
      try {
        await response.body?.cancel();
      } catch {
      }
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after status ${response.status}`
      );
      await sleep(computeBackoffDelay(attempt, retryAfterMs));
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_RETRIES) throw error;
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after network error`
      );
      await sleep(computeBackoffDelay(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM request failed after exhausting retries");
};
async function invokeLLM(params) {
  assertApiKey();
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    model,
    thinking,
    reasoning,
    maxTokens,
    max_tokens
  } = params;
  const payload = {
    messages: messages.map(normalizeMessage)
  };
  if (model) {
    payload.model = model;
  }
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  const resolvedMaxTokens = max_tokens ?? maxTokens;
  if (typeof resolvedMaxTokens === "number") {
    payload.max_tokens = resolvedMaxTokens;
  }
  if (thinking) {
    payload.thinking = thinking;
  }
  if (reasoning) {
    payload.reasoning = reasoning;
  }
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetchWithBackoff(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return await response.json();
}
async function listLLMModels() {
  assertApiKey();
  const base = platformApiBase();
  const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  const response = await fetchWithBackoff(url, {
    headers: { authorization: `Bearer ${ENV.forgeApiKey}` }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `List LLM models failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return await response.json();
}

// server/forms.ts
import { z } from "zod";
var QUESTION_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "url",
  "date",
  "time",
  "date_time",
  "dropdown",
  "single_choice",
  "multiple_choice",
  "checkbox",
  "yes_no",
  "rating",
  "opinion_scale",
  "nps",
  "ranking",
  "file_upload",
  "signature",
  "image_choice",
  "address",
  "name",
  "matrix",
  "hidden_field",
  "payment",
  "scheduling"
];
function editRequiresUnpublishForPayment(status, questions) {
  return status === "published" && questions.some((question) => question.type === "payment");
}
var questionInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum([...QUESTION_TYPES, "hidden"]),
  label: z.string().trim().min(1).max(255).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(5e3).optional().nullable(),
  required: z.boolean().default(false),
  options: z.array(z.string().max(500)).max(100).optional(),
  settings: z.record(z.string(), z.unknown()).optional().default({}),
  logic: z.object({
    questionId: z.string().uuid().optional(),
    whenQuestionId: z.string().uuid().optional(),
    operator: z.enum(["equals", "not_equals", "contains", "exists"]).optional().default("equals"),
    value: z.unknown().optional()
  }).optional().nullable()
}).superRefine((question, ctx) => {
  if (!question.label && !question.title) ctx.addIssue({ code: "custom", path: ["label"], message: "A question label is required." });
});
var answerValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown()), z.null()]);
var answersSchema = z.record(z.string().uuid(), answerValue);
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var optionsFor = (question) => {
  const configured = question.options ?? question.settings?.options;
  return Array.isArray(configured) ? configured.map(String) : ["Option 1", "Option 2", "Option 3"];
};
var numberValue = (value) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
var dateOnlyValid = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && (/* @__PURE__ */ new Date(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
function validateQuestionAnswers(questions, answers) {
  const errors = {};
  const visible = /* @__PURE__ */ new Set();
  for (const question of questions) {
    const rule = question.logic;
    let isVisible = true;
    if (rule) {
      const actual = answers[rule.questionId ?? rule.whenQuestionId ?? ""];
      if (rule.operator === "exists") isVisible = actual !== void 0 && actual !== null && actual !== "";
      if (rule.operator === "equals") isVisible = JSON.stringify(actual) === JSON.stringify(rule.value);
      if (rule.operator === "not_equals") isVisible = JSON.stringify(actual) !== JSON.stringify(rule.value);
      if (rule.operator === "contains") isVisible = Array.isArray(actual) ? actual.some((item) => String(item) === String(rule.value)) : String(actual ?? "").toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    }
    if (!isVisible) continue;
    visible.add(question.id);
    const value = answers[question.id];
    const hasValue = value !== void 0 && value !== null && value !== "";
    const empty = !hasValue || Array.isArray(value) && value.length === 0 || question.type === "checkbox" && value !== true;
    if (question.required && empty) errors[question.id] = "This question is required.";
    if (!hasValue) continue;
    const fail = (message) => {
      errors[question.id] = message;
    };
    const options = optionsFor(question);
    const optionSet = new Set(options);
    switch (question.type) {
      case "email":
        if (typeof value !== "string" || !z.string().email().safeParse(value).success) fail("Enter a valid email address.");
        break;
      case "phone":
        if (typeof value !== "string" || value.length > 100 || !/^[+()\d\s.-]+$/.test(value)) fail("Enter a valid phone number.");
        break;
      case "url":
        if (typeof value !== "string" || !z.string().url().safeParse(value).success) fail("Enter a valid URL.");
        break;
      case "number": {
        const n = numberValue(value);
        if (!Number.isFinite(n)) fail("Enter a valid number.");
        else if (typeof question.settings?.min === "number" && n < question.settings.min) fail(`Enter a number of at least ${question.settings.min}.`);
        else if (typeof question.settings?.max === "number" && n > question.settings.max) fail(`Enter a number no greater than ${question.settings.max}.`);
        break;
      }
      case "date":
        if (!dateOnlyValid(value)) fail("Enter a valid date.");
        break;
      case "time":
        if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) fail("Enter a valid time.");
        break;
      case "date_time":
      case "scheduling":
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail("Enter a valid date and time.");
        break;
      case "rating": {
        const n = numberValue(value);
        if (!Number.isInteger(n) || n < 1 || n > 5) fail("Choose a rating from 1 to 5.");
        break;
      }
      case "opinion_scale": {
        const n = numberValue(value);
        const min = typeof question.settings?.min === "number" ? question.settings.min : 1;
        const max = typeof question.settings?.max === "number" ? question.settings.max : 5;
        if (!Number.isInteger(n) || n < min || n > max) fail(`Choose a value from ${min} to ${max}.`);
        break;
      }
      case "nps": {
        const n = numberValue(value);
        if (!Number.isInteger(n) || n < 0 || n > 10) fail("Choose a score from 0 to 10.");
        break;
      }
      case "dropdown":
      case "single_choice":
      case "image_choice":
        if (typeof value !== "string" || !optionSet.has(value)) fail("Choose one of the available options.");
        break;
      case "yes_no":
        if (value !== "Yes" && value !== "No") fail("Choose Yes or No.");
        break;
      case "multiple_choice":
      case "ranking":
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !optionSet.has(item)) || new Set(value).size !== value.length) fail("Use only distinct available options.");
        break;
      case "checkbox":
        if (typeof value !== "boolean") fail("Choose a valid checkbox value.");
        break;
      case "matrix": {
        const rows = Array.isArray(question.settings?.rows) ? question.settings.rows.map(String) : ["Experience", "Value", "Support"];
        if (!isRecord(value) || Object.keys(value).some((row) => !rows.includes(row)) || Object.values(value).some((answer) => typeof answer !== "string" || !optionSet.has(answer))) fail("Complete the matrix using the available rows and options.");
        else if (question.required && rows.some((row) => !(row in value))) fail("Complete every row in this matrix.");
        break;
      }
      case "file_upload":
        if (!isRecord(value) || typeof value.name !== "string" || value.name.length > 255 || typeof value.path !== "string" || !/^\/manus-storage\/(?:coforms|spaceform)\/forms\/[a-f0-9-]+\/questions\/[a-f0-9-]+\/[a-zA-Z0-9._/-]{1,512}$/.test(value.path)) fail("Choose a valid uploaded file.");
        break;
      case "signature":
        if (typeof value !== "string" || value.length > 2e6 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) fail("Provide a valid signature.");
        break;
      case "short_text":
      case "name":
      case "address":
      case "hidden":
      case "hidden_field":
        if (typeof value !== "string" || value.length > 5e3) fail("Enter a valid text answer.");
        break;
      case "long_text":
        if (typeof value !== "string" || value.length > 2e4) fail("Keep your answer under 20,000 characters.");
        break;
      case "payment":
        fail("Payment collection is not configured for this form.");
        break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, visibleQuestionIds: visible };
}
function csvCell(value) {
  const raw = Array.isArray(value) || value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}
function responsesToCsv(rows, columns) {
  const header = ["submitted_at", ...columns.map((column) => column.label)];
  return [header.map(csvCell).join(","), ...rows.map((row) => [row.submittedAt?.toISOString() ?? "", ...columns.map((column) => row.answers[column.id])].map(csvCell).join(","))].join("\n") + "\n";
}
function publicQuestion(question) {
  return {
    id: question.id,
    position: question.position,
    type: question.type,
    label: question.label,
    description: question.description,
    required: Boolean(question.required),
    settings: parseJson(question.settings),
    logic: parseJson(question.logic)
  };
}
function respondentQuestion(question) {
  const { logic: _privateLogic, ...safeQuestion } = publicQuestion({ ...question, logic: null });
  return safeQuestion;
}
function parseJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// server/ai.ts
var draftSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: QUESTION_TYPES.map((type) => type === "hidden_field" ? "hidden" : type) },
          label: { type: "string" },
          description: { type: "string" },
          required: { type: "boolean" },
          options: { type: "array", items: { type: "string" } }
        },
        required: ["type", "label", "description", "required", "options"],
        additionalProperties: false
      }
    }
  },
  required: ["title", "description", "questions"],
  additionalProperties: false
};
async function selectAvailableModel() {
  const configured = process.env.MANUS_LLM_MODEL || process.env.NVIDIA_MODEL;
  if (configured) return configured;
  if (process.env.NVIDIA_API_KEY) return "nvidia/nemotron-3-ultra-550b-a55b";
  try {
    const catalog = await listLLMModels();
    const available = new Set(catalog.data.map((model) => model.id));
    if (available.has("gpt-5-mini")) return "gpt-5-mini";
    const gpt = catalog.data.find((model) => model.id.startsWith("gpt-5"))?.id;
    const fallback = gpt ?? catalog.data[0]?.id;
    if (fallback) return fallback;
  } catch {
  }
  return "nvidia/nemotron-3-ultra-550b-a55b";
}
function parseJson2(text2) {
  const cleaned = text2.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI returned invalid JSON.");
  }
}
async function generateDraft(prompt) {
  const model = await selectAvailableModel();
  const systemPrompt = `Create a useful, concise form draft. Use suitable question types, keep the wording clear, and return ONLY a valid JSON object matching this schema:
${JSON.stringify(draftSchema, null, 2)}

IMPORTANT: Output raw JSON only. No markdown, no code fences, no explanation.`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ];
  let response;
  try {
    response = await invokeLLM({
      model,
      messages,
      response_format: { type: "json_schema", json_schema: { name: "coforms_draft", strict: true, schema: draftSchema } }
    });
  } catch {
    try {
      response = await invokeLLM({
        model,
        messages,
        response_format: { type: "json_object" }
      });
    } catch {
      response = await invokeLLM({ model, messages });
    }
  }
  const proxyError = response.error;
  if (proxyError) throw new Error(typeof proxyError === "string" ? proxyError : proxyError.message || "AI drafting failed.");
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error("AI returned no draft. Try again or create the form manually.");
  const parsed = parseJson2(content);
  const object = parsed && typeof parsed === "object" ? parsed : null;
  if (!object || typeof object.title !== "string" || typeof object.description !== "string" || !Array.isArray(object.questions)) throw new Error("AI draft did not match the expected form shape.");
  const questions = object.questions.map((item) => questionInputSchema.parse(item));
  return { title: object.title.trim().slice(0, 255), description: object.description.trim().slice(0, 5e3), questions };
}
function fallbackExtraction(input) {
  const text2 = input.utterance.trim();
  const q = input.currentQuestion;
  const lower = text2.toLowerCase();
  const options = q.options || [];
  if (q.type === "yes_no") {
    if (["yes", "yeah", "yep", "sure", "definitely", "true", "ok"].some((w) => lower.includes(w))) {
      return { assistantMessage: "Got it, thank you!", proposedAnswer: { questionId: q.id, value: "Yes", displayValue: "Yes" }, clarificationNeeded: false };
    }
    if (["no", "nope", "nah", "negative", "false"].some((w) => lower.includes(w))) {
      return { assistantMessage: "Understood, noted as no.", proposedAnswer: { questionId: q.id, value: "No", displayValue: "No" }, clarificationNeeded: false };
    }
    return { assistantMessage: 'Could you please confirm with a simple "Yes" or "No"?', clarificationNeeded: true, clarificationReason: 'Expected "Yes" or "No".' };
  }
  if (q.type === "rating") {
    const numMatch = text2.match(/\b([1-5])\b/);
    const wordMap = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const val = numMatch ? Number(numMatch[1]) : wordMap[lower];
    if (val && val >= 1 && val <= 5) {
      return { assistantMessage: `Thank you for the ${val}-star rating!`, proposedAnswer: { questionId: q.id, value: val, displayValue: `${val} stars` }, clarificationNeeded: false };
    }
    return { assistantMessage: "Please provide a score from 1 to 5.", clarificationNeeded: true, clarificationReason: "Rating must be between 1 and 5." };
  }
  if (q.type === "single_choice" || q.type === "dropdown") {
    const exact = options.find((o) => o.toLowerCase() === lower);
    if (exact) {
      return { assistantMessage: `Great, selected ${exact}.`, proposedAnswer: { questionId: q.id, value: exact, displayValue: exact }, clarificationNeeded: false };
    }
    const matched = options.filter((o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()));
    if (matched.length === 1) {
      return { assistantMessage: `Got it, ${matched[0]}.`, proposedAnswer: { questionId: q.id, value: matched[0], displayValue: matched[0] }, clarificationNeeded: false };
    }
    return {
      assistantMessage: options.length ? `Could you choose one of the available options: ${options.join(", ")}?` : "Could you clarify your choice?",
      clarificationNeeded: true,
      clarificationReason: "Answer did not match any available option."
    };
  }
  if (q.type === "email") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = text2.replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "");
    if (emailRegex.test(cleanEmail)) {
      return { assistantMessage: `Thanks! Noted your email as ${cleanEmail}.`, proposedAnswer: { questionId: q.id, value: cleanEmail, displayValue: cleanEmail }, clarificationNeeded: false };
    }
    return { assistantMessage: "Please provide a valid email address.", clarificationNeeded: true, clarificationReason: "Invalid email format." };
  }
  return {
    assistantMessage: "Thank you, noted!",
    proposedAnswer: { questionId: q.id, value: text2, displayValue: text2 },
    clarificationNeeded: false
  };
}
async function generateInterviewTurn(input) {
  const q = input.currentQuestion;
  const lang = input.language || "en";
  const systemPrompt = `You are an empathetic, professional research interviewer for CoForms.
The respondent is answering an official research question.
Active Question: "${q.title}"
Question Type: "${q.type}"
Allowed Options: ${JSON.stringify(q.options || [])}
Target Response Language: ${lang}

Respondent said: "${input.utterance}"

Instructions:
1. Extract the respondent's intended answer into "proposedValue".
   - If question type is "rating", proposedValue MUST be an integer from 1 to 5.
   - If question type is "yes_no", proposedValue MUST be "Yes" or "No".
   - If question type is "single_choice" or "dropdown", proposedValue MUST be one of the Allowed Options.
   - If question type is "multiple_choice", proposedValue MUST be an array of matching Allowed Options.
   - If question type is "email", proposedValue MUST be a valid email string.
   - If question type is "number", proposedValue MUST be a finite number.
   - If question type is "short_text" or "long_text", proposedValue MUST be a clean string.
2. If the respondent's utterance is ambiguous, off-topic, or refuses to answer, set "clarificationNeeded": true and explain in "clarificationReason".
3. Provide an "assistantMessage" in ${lang}:
   - If answer is clear, acknowledge their answer naturally and briefly.
   - If clarification is needed, politely ask them to clarify or choose from available options.

OUTPUT FORMAT: Return raw JSON only with these keys:
{
  "assistantMessage": string,
  "proposedValue": any or null,
  "displayValue": string,
  "clarificationNeeded": boolean,
  "clarificationReason": string or null
}`;
  try {
    const model = await selectAvailableModel();
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.utterance }
    ];
    let response;
    try {
      response = await invokeLLM({
        model,
        messages,
        response_format: { type: "json_object" },
        max_tokens: 300
      });
    } catch {
      response = await invokeLLM({ model, messages, max_tokens: 300 });
    }
    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      const parsed = parseJson2(content);
      if (parsed && typeof parsed.assistantMessage === "string") {
        const clarificationNeeded = Boolean(parsed.clarificationNeeded);
        const clarificationReason = typeof parsed.clarificationReason === "string" ? parsed.clarificationReason : void 0;
        let proposedAnswer = void 0;
        if (!clarificationNeeded && parsed.proposedValue !== void 0 && parsed.proposedValue !== null) {
          proposedAnswer = {
            questionId: q.id,
            value: parsed.proposedValue,
            displayValue: typeof parsed.displayValue === "string" ? parsed.displayValue : String(parsed.proposedValue)
          };
        }
        return {
          assistantMessage: parsed.assistantMessage.trim(),
          proposedAnswer,
          clarificationNeeded,
          clarificationReason
        };
      }
    }
  } catch {
  }
  return fallbackExtraction(input);
}

// server/sarvam.ts
var SARVAM_BASE = "https://api.sarvam.ai";
var SARVAM_LANG_MAP = {
  en: "en-IN",
  hi: "hi-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  od: "od-IN",
  pa: "pa-IN",
  ta: "ta-IN",
  te: "te-IN"
};
function toSarvamLang(lang) {
  return SARVAM_LANG_MAP[lang] ?? lang;
}
function getSarvamKey() {
  const key = process.env.SARVAM_API_KEY;
  if (!key || !key.trim()) throw new Error("SARVAM_API_KEY is not configured on the server.");
  return key.trim();
}
async function sarvamSTT(input) {
  let key;
  try {
    key = getSarvamKey();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sarvam key missing" };
  }
  const lang = toSarvamLang(input.language ?? "hi");
  const ext = mimeToExt(input.mimeType ?? "audio/webm");
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.audioBuffer)], {
    type: input.mimeType ?? "audio/webm"
  });
  form.append("file", blob, `audio.${ext}`);
  form.append("language_code", lang);
  form.append("model", "saaras:v3");
  let res;
  try {
    res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form
    });
  } catch (err) {
    return { error: `Sarvam STT network error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Sarvam STT ${res.status}: ${body}` };
  }
  const json = await res.json();
  if (typeof json.transcript !== "string") {
    return { error: "Sarvam STT: unexpected response shape" };
  }
  return {
    transcript: json.transcript,
    language_code: json.language_code ?? lang
  };
}
var DEFAULT_SPEAKER = {
  "en-IN": "priya",
  "hi-IN": "priya",
  "bn-IN": "priya",
  "gu-IN": "priya",
  "kn-IN": "priya",
  "ml-IN": "priya",
  "mr-IN": "priya",
  "od-IN": "priya",
  "pa-IN": "priya",
  "ta-IN": "priya",
  "te-IN": "priya"
};
async function sarvamTTS(input) {
  let key;
  try {
    key = getSarvamKey();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sarvam key missing" };
  }
  const lang = toSarvamLang(input.language ?? "hi");
  const speaker = input.speaker ?? DEFAULT_SPEAKER[lang] ?? "priya";
  const chunks = splitTextIntoChunks(input.text.trim(), 500);
  const audioParts = [];
  for (const chunk of chunks) {
    let res;
    try {
      res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
        method: "POST",
        headers: {
          "api-subscription-key": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: [chunk],
          target_language_code: lang,
          speaker,
          pitch: 0,
          pace: 1,
          loudness: 1.5,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model: "bulbul:v3"
        })
      });
    } catch (err) {
      return { error: `Sarvam TTS network error: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `Sarvam TTS ${res.status}: ${body}` };
    }
    const json = await res.json();
    if (!Array.isArray(json.audios) || !json.audios[0]) {
      return { error: "Sarvam TTS: unexpected response shape" };
    }
    audioParts.push(json.audios[0]);
  }
  return { audioBase64: audioParts.join("|") };
}
function mimeToExt(mimeType) {
  const map = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a"
  };
  return map[mimeType] ?? "webm";
}
function splitTextIntoChunks(text2, maxLen) {
  if (text2.length <= maxLen) return [text2];
  const chunks = [];
  const sentences = text2.split(/(?<=[.!?।])\s+/);
  let current = "";
  for (const sent of sentences) {
    if (current.length + sent.length + 1 > maxLen) {
      if (current) chunks.push(current.trim());
      current = sent;
    } else {
      current = current ? `${current} ${sent}` : sent;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// server/uploads.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
var ALLOWED_MIME = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"]);
async function preparePublicUpload(input) {
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_UPLOAD_BYTES) throw new Error("File must be between 1 byte and 10 MB.");
  if (!ALLOWED_MIME.has(input.mimeType.toLowerCase())) throw new Error("This file type is not supported.");
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload";
  const key = `coforms/forms/${input.formId}/questions/${input.questionId}/${randomUUID2()}-${safeName}`;
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) throw new Error("File uploads are unavailable until storage is configured.");
  const endpoint = new URL("v1/storage/presign/put", ENV.forgeApiUrl.replace(/\/+$/, "") + "/");
  endpoint.searchParams.set("path", key);
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${ENV.forgeApiKey}` } });
  if (!response.ok) throw new Error(`Storage presign failed (${response.status}).`);
  const data = await response.json();
  if (!data.url) throw new Error(data.error || "Storage did not return an upload URL.");
  await insertUpload({ id: randomUUID2(), formId: input.formId, key, url: `/manus-storage/${key}`, contentType: input.mimeType, byteSize: input.size });
  return { uploadUrl: data.url, assetPath: `/manus-storage/${key}` };
}

// server/_core/systemRouter.ts
import { z as z2 } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.appUser) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      appUser: ctx.appUser
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z2.object({
      timestamp: z2.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z2.object({
      title: z2.string().min(1, "title is required"),
      content: z2.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
var accountInput = z3.object({ name: z3.string().trim().min(1).max(160), email: z3.string().email().max(320), password: z3.string().min(12).max(200) });
var safeHttpsUrl = (value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};
var redirectUrlInput = z3.string().trim().max(2048).refine((value) => value === "" || value.startsWith("/") && !value.startsWith("//") || safeHttpsUrl(value), "Use a same-site path or a secure HTTPS URL.");
var logoUrlInput = z3.string().trim().max(2048).refine((value) => value === "" || safeHttpsUrl(value), "Use a secure HTTPS image URL.");
var formSettingsInput = z3.object({ thankYouText: z3.string().trim().max(500).optional(), redirectUrl: redirectUrlInput.optional(), logoUrl: logoUrlInput.optional(), conversationalMode: z3.boolean().optional() });
var formUpdateInput = z3.object({ id: z3.string().uuid(), title: z3.string().trim().min(1).max(255), description: z3.string().max(5e3).nullable().optional(), questions: z3.array(questionInputSchema).max(100), theme: z3.record(z3.string(), z3.unknown()).nullable().optional(), settings: formSettingsInput.optional() });
function setAppCookie(res, token, expiresAt) {
  res.cookie(SPACEFORM_SESSION_COOKIE, token, { ...getSessionCookieOptions(res.req), maxAge: Math.max(0, expiresAt.getTime() - Date.now()) });
}
function publicForm(form, questions, includeLogic = true) {
  return { id: form.id, title: form.title, description: form.description, slug: form.slug, status: form.status, theme: parseJson(form.theme), settings: parseJson(form.settings), ...form.responseCount === void 0 ? {} : { responseCount: Number(form.responseCount) }, questions: questions.map((question) => includeLogic ? publicQuestion(question) : respondentQuestion(question)) };
}
function responseData(result) {
  const answersByResponse = /* @__PURE__ */ new Map();
  for (const answer of result.answers) {
    const values = answersByResponse.get(answer.responseId) ?? {};
    try {
      values[answer.questionId] = answer.value ? JSON.parse(answer.value) : null;
    } catch {
      values[answer.questionId] = answer.value;
    }
    answersByResponse.set(answer.responseId, values);
  }
  return answersByResponse;
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.appUser ? publicAccount(ctx.appUser) : null),
    googleEnabled: publicProcedure.query(() => ({ enabled: googleConfiguration(), message: googleConfiguration() ? "Google sign-in is configured." : "Google sign-in is unavailable until Google credentials are configured." })),
    signup: publicProcedure.input(accountInput).mutation(async ({ input, ctx }) => {
      try {
        const account = await signupAccount(input.name, input.email, input.password);
        const session = await createAppSession(account.id);
        setAppCookie(ctx.res, session.token, session.expiresAt);
        return publicAccount(account);
      } catch (error) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unable to create account." });
      }
    }),
    login: publicProcedure.input(z3.object({ email: z3.string().email(), password: z3.string().min(1).max(200) })).mutation(async ({ input, ctx }) => {
      try {
        const account = await loginAccount(input.email, input.password);
        const session = await createAppSession(account.id);
        setAppCookie(ctx.res, session.token, session.expiresAt);
        return publicAccount(account);
      } catch (error) {
        throw new TRPCError3({ code: "UNAUTHORIZED", message: error instanceof Error ? error.message : "Invalid email or password." });
      }
    }),
    requestPasswordReset: publicProcedure.input(z3.object({ email: z3.string().email() })).mutation(async () => ({ status: "unavailable", message: "Password reset email delivery is not configured; no email was sent." })),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.appSessionToken) {
        await revokeAppSession(ctx.appSessionToken);
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(SPACEFORM_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  forms: router({
    list: protectedProcedure.query(({ ctx }) => listFormsForAccount(ctx.appUser.id)),
    create: protectedProcedure.input(z3.object({ title: z3.string().trim().min(1).max(255), description: z3.string().max(5e3).optional() })).mutation(({ ctx, input }) => createForm(ctx.appUser.id, input.title, input.description)),
    get: protectedProcedure.input(z3.object({ id: z3.string().uuid() })).query(async ({ ctx, input }) => {
      const form = await getFormForAccount(input.id, ctx.appUser.id);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      return publicForm(form, await getQuestions(form.id));
    }),
    update: protectedProcedure.input(formUpdateInput).mutation(async ({ ctx, input }) => {
      const normalized = { ...input, questions: input.questions.map((question) => ({ ...question, type: question.type === "hidden" ? "hidden_field" : question.type, label: question.label ?? question.title ?? "", settings: { ...question.settings ?? {}, ...question.options ? { options: question.options } : {} }, logic: question.logic ? { ...question.logic, questionId: question.logic.questionId ?? question.logic.whenQuestionId } : null })) };
      const owned = await getFormForAccount(input.id, ctx.appUser.id);
      if (!owned) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      if (editRequiresUnpublishForPayment(owned.status, normalized.questions)) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "Unpublish this form before adding a payment question. Payment processing is not configured." });
      const form = await updateForm(input.id, ctx.appUser.id, normalized);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      return publicForm(form, await getQuestions(form.id));
    }),
    setPublished: protectedProcedure.input(z3.object({ id: z3.string().uuid(), published: z3.boolean() })).mutation(async ({ ctx, input }) => {
      const owned = await getFormForAccount(input.id, ctx.appUser.id);
      if (!owned) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      const questions = await getQuestions(owned.id);
      if (input.published && questions.length === 0) throw new TRPCError3({ code: "BAD_REQUEST", message: "Add at least one question before publishing." });
      if (input.published && questions.some((question) => question.type === "payment")) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "Payment questions cannot be published until a payment provider is connected." });
      const form = await setFormPublished(input.id, ctx.appUser.id, input.published);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      return publicForm(form, await getQuestions(form.id));
    }),
    bySlug: publicProcedure.input(z3.object({ slug: z3.string().min(8).max(96).regex(/^[a-z0-9-]+$/) })).query(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      return publicForm(form, await getQuestions(form.id), false);
    }),
    start: publicProcedure.input(z3.object({ slug: z3.string().min(8).max(96).regex(/^[a-z0-9-]+$/) })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      return startFormResponse(form.id);
    }),
    progress: publicProcedure.input(z3.object({ slug: z3.string().min(8).max(96), responseId: z3.string().uuid(), progressToken: z3.string().min(32).max(100), questionId: z3.string().uuid() })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      const recorded = await recordResponseQuestionView({ formId: form.id, responseId: input.responseId, progressToken: input.progressToken, questionId: input.questionId });
      if (!recorded) throw new TRPCError3({ code: "BAD_REQUEST", message: "This response session is no longer active." });
      return { success: true };
    }),
    visible: publicProcedure.input(z3.object({ slug: z3.string().min(8).max(96), answers: answersSchema })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      const questions = await getQuestions(form.id);
      const normalizedQuestions = questions.map((question) => ({ ...question, required: Boolean(question.required), settings: parseJson(question.settings) ?? {}, logic: parseJson(question.logic) }));
      const result = validateQuestionAnswers(normalizedQuestions, input.answers);
      return { questionIds: Array.from(result.visibleQuestionIds) };
    }),
    prepareUpload: publicProcedure.input(z3.object({ slug: z3.string().min(8).max(96), questionId: z3.string().uuid(), fileName: z3.string().min(1).max(255), mimeType: z3.string().min(1).max(160), size: z3.number().int().positive() })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      const question = (await getQuestions(form.id)).find((item) => item.id === input.questionId);
      if (!question || question.type !== "file_upload") throw new TRPCError3({ code: "BAD_REQUEST", message: "This question does not accept files." });
      try {
        return await preparePublicUpload({ formId: form.id, questionId: question.id, fileName: input.fileName, mimeType: input.mimeType, size: input.size });
      } catch (error) {
        throw new TRPCError3({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "Uploads are unavailable." });
      }
    }),
    submit: publicProcedure.input(z3.object({ slug: z3.string().min(8).max(96), responseId: z3.string().uuid(), progressToken: z3.string().min(32).max(100), answers: answersSchema })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      const questions = await getQuestions(form.id);
      const normalizedQuestions = questions.map((question) => ({ ...question, required: Boolean(question.required), settings: parseJson(question.settings) ?? {}, logic: parseJson(question.logic) }));
      const validation = validateQuestionAnswers(normalizedQuestions, input.answers);
      if (!validation.ok) throw new TRPCError3({ code: "BAD_REQUEST", message: "Please review the answers and try again.", cause: validation.errors });
      const visible = validation.visibleQuestionIds;
      const answerRows = Object.entries(input.answers).filter(([questionId]) => visible.has(questionId)).map(([questionId, value]) => ({ questionId, value }));
      const uploadedPaths = [];
      for (const question of questions) {
        if (question.type !== "file_upload" || !visible.has(question.id)) continue;
        const value = input.answers[question.id];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const assetPath = value.path;
        if (typeof assetPath !== "string") continue;
        const upload = await getPublicUploadForQuestion(form.id, question.id, assetPath);
        if (!upload) throw new TRPCError3({ code: "BAD_REQUEST", message: "This file does not belong to the selected question. Please upload it again." });
        uploadedPaths.push(assetPath);
      }
      const completed = await completeFormResponse({ formId: form.id, responseId: input.responseId, progressToken: input.progressToken, answers: answerRows });
      if (!completed) throw new TRPCError3({ code: "BAD_REQUEST", message: "This response session has expired or was already submitted." });
      await bindPublicUploadsToResponse(form.id, input.responseId, uploadedPaths);
      const redirectCandidate = parseJson(form.settings)?.redirectUrl;
      return { responseId: input.responseId, status: "submitted", redirectUrl: typeof redirectCandidate === "string" && redirectCandidate ? redirectCandidate : null };
    }),
    interviewTurn: publicProcedure.input(z3.object({
      slug: z3.string().min(8).max(96).regex(/^[a-z0-9-]+$/),
      responseId: z3.string().uuid(),
      progressToken: z3.string().min(32).max(100),
      utterance: z3.string().min(1).max(2e3),
      currentAnswers: answersSchema,
      language: z3.string().max(10).optional().default("en")
    })).mutation(async ({ input }) => {
      const form = await getPublishedFormBySlug(input.slug);
      if (!form) throw new TRPCError3({ code: "NOT_FOUND", message: "Published form not found." });
      const questions = await getQuestions(form.id);
      if (!questions.length) throw new TRPCError3({ code: "BAD_REQUEST", message: "This form has no questions." });
      const db = await getDb();
      if (!db) throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Database is unavailable." });
      const responseRows = await db.select().from(sfResponses).where(and2(eq2(sfResponses.id, input.responseId), eq2(sfResponses.formId, form.id), eq2(sfResponses.status, "in_progress"))).limit(1);
      const response = responseRows[0];
      if (!response || !progressTokenMatches(response.metadata, input.progressToken)) {
        throw new TRPCError3({ code: "UNAUTHORIZED", message: "Invalid or expired response session token." });
      }
      const normalizedQuestions = questions.map((question) => ({
        ...question,
        required: Boolean(question.required),
        settings: parseJson(question.settings) ?? {},
        logic: parseJson(question.logic)
      }));
      const validation = validateQuestionAnswers(normalizedQuestions, input.currentAnswers);
      const visibleList = normalizedQuestions.filter((q) => validation.visibleQuestionIds.has(q.id));
      const activeQuestion = visibleList.find((q) => {
        const val = input.currentAnswers[q.id];
        return val === void 0 || val === null || val === "" || Array.isArray(val) && val.length === 0;
      }) || visibleList[visibleList.length - 1];
      const remainingCount = visibleList.filter((q) => {
        const val = input.currentAnswers[q.id];
        return val === void 0 || val === null || val === "" || Array.isArray(val) && val.length === 0;
      }).length;
      const configuredOptions = activeQuestion.options ?? activeQuestion.settings?.options;
      const options = Array.isArray(configuredOptions) ? configuredOptions.map(String) : [];
      const turn = await generateInterviewTurn({
        currentQuestion: {
          id: activeQuestion.id,
          type: activeQuestion.type,
          title: activeQuestion.label || activeQuestion.title || "Question",
          description: activeQuestion.description,
          required: Boolean(activeQuestion.required),
          options,
          settings: activeQuestion.settings
        },
        utterance: input.utterance,
        language: input.language,
        remainingQuestionCount: remainingCount
      });
      let verifiedAnswer = void 0;
      if (turn.proposedAnswer && !turn.clarificationNeeded) {
        const testAnswers = { ...input.currentAnswers, [activeQuestion.id]: turn.proposedAnswer.value };
        const testValidation = validateQuestionAnswers(normalizedQuestions, testAnswers);
        if (!testValidation.errors[activeQuestion.id]) {
          verifiedAnswer = {
            questionId: activeQuestion.id,
            value: turn.proposedAnswer.value,
            displayValue: turn.proposedAnswer.displayValue
          };
        } else {
          turn.clarificationNeeded = true;
          turn.clarificationReason = testValidation.errors[activeQuestion.id];
          turn.assistantMessage = `${turn.assistantMessage} Could you clarify? ${testValidation.errors[activeQuestion.id]}`;
        }
      }
      const simulatedAnswers = verifiedAnswer ? { ...input.currentAnswers, [activeQuestion.id]: verifiedAnswer.value } : input.currentAnswers;
      const finalValidation = validateQuestionAnswers(normalizedQuestions, simulatedAnswers);
      return {
        assistantMessage: turn.assistantMessage,
        proposedAnswer: verifiedAnswer,
        clarificationNeeded: turn.clarificationNeeded,
        clarificationReason: turn.clarificationReason,
        activeQuestionId: activeQuestion.id,
        isComplete: finalValidation.ok
      };
    }),
    // ── Sarvam AI: TTS proxy ─────────────────────────────────────────────
    sarvamTTS: publicProcedure.input(z3.object({
      text: z3.string().min(1).max(2e3),
      language: z3.string().max(10).optional().default("hi"),
      speaker: z3.string().max(40).optional()
    })).mutation(async ({ input }) => {
      const result = await sarvamTTS({ text: input.text, language: input.language, speaker: input.speaker });
      if ("error" in result) throw new TRPCError3({ code: "BAD_REQUEST", message: result.error });
      return result;
    }),
    // ── Sarvam AI: STT proxy ─────────────────────────────────────────────
    sarvamSTT: publicProcedure.input(z3.object({
      audioBase64: z3.string().min(1),
      mimeType: z3.string().max(60).optional().default("audio/webm"),
      language: z3.string().max(10).optional().default("hi")
    })).mutation(async ({ input }) => {
      const buf = Buffer.from(input.audioBase64, "base64");
      const result = await sarvamSTT({ audioBuffer: buf, mimeType: input.mimeType, language: input.language });
      if ("error" in result) throw new TRPCError3({ code: "BAD_REQUEST", message: result.error });
      return result;
    }),
    responses: protectedProcedure.input(z3.object({ formId: z3.string().uuid() })).query(async ({ ctx, input }) => {
      const result = await listResponsesForAccount(input.formId, ctx.appUser.id);
      if (!result) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      const map = responseData(result);
      return { form: { id: result.form.id, title: result.form.title, slug: result.form.slug }, questions: (await getAllQuestions(input.formId)).map(publicQuestion), responses: result.responses.map((response) => ({ id: response.id, status: response.status, submittedAt: response.submittedAt, answers: map.get(response.id) ?? {} })), metrics: { total: result.metrics.submitted, submitted: result.metrics.submitted, started: result.metrics.started, completionRate: result.metrics.started ? Math.round(result.metrics.submitted / result.metrics.started * 100) : 0, questionViews: result.metrics.questionViews } };
    }),
    responsesCsv: protectedProcedure.input(z3.object({ formId: z3.string().uuid() })).query(async ({ ctx, input }) => {
      const result = await listResponsesForAccount(input.formId, ctx.appUser.id);
      if (!result) throw new TRPCError3({ code: "NOT_FOUND", message: "Form not found." });
      const map = responseData(result);
      const questions = await getAllQuestions(input.formId);
      return responsesToCsv(result.responses.map((response) => ({ submittedAt: response.submittedAt, answers: map.get(response.id) ?? {} })), questions.map((question) => ({ id: question.id, label: question.label })));
    })
  }),
  ai: router({ generate: protectedProcedure.input(z3.object({ prompt: z3.string().trim().min(3).max(2e3) })).mutation(async ({ input }) => {
    try {
      return await generateDraft(input.prompt);
    } catch (error) {
      throw new TRPCError3({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "AI drafting failed. Try a manual draft instead." });
    }
  }) })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  let appUser = null;
  let appSessionToken = null;
  try {
    const appSession = await accountFromRequest(opts.req);
    appUser = appSession?.account ?? null;
    appSessionToken = appSession?.token ?? null;
  } catch (error) {
    console.error("[CoForms auth] Failed to resolve app session:", error);
  }
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user,
    appUser,
    appSessionToken
  };
}

// server/_core/app.ts
function createExpressApp() {
  const app2 = express();
  app2.use((req, _res, next) => {
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
      }
    }
    const forwarded = req.headers["x-matched-path"] || req.headers["x-forwarded-uri"];
    if (forwarded && forwarded.startsWith("/api")) {
      const qIndex = req.url.indexOf("?");
      const query = qIndex !== -1 ? req.url.substring(qIndex) : "";
      req.url = forwarded.includes("?") ? forwarded : forwarded + query;
    }
    next();
  });
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ limit: "50mb", extended: true }));
  app2.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app2.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app2);
  registerSpaceFormGoogleRoutes(app2);
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app2;
}

// server/vercel.ts
var app = createExpressApp();
var vercel_default = app;
export {
  vercel_default as default
};
