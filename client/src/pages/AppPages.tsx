import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight,
  Clipboard, Copy, Download, ExternalLink, Eye, FilePlus2, FileText, GripVertical,
  LayoutDashboard, Link2, LoaderCircle, LogOut, Mail, Menu, Mic, MicOff, MoreHorizontal,
  Palette, Plus, Search, Settings2, Share2, Sparkles, Trash2, Upload, Volume2, VolumeX, WandSparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { createDebouncedSave } from "@/lib/debouncedSave";
import { csvCell, hasResponseValue } from "@/lib/responseData";
import { useVoiceForm } from "@/hooks/useVoiceForm";
import { InteractiveVoiceAgent } from "@/components/interview/InteractiveVoiceAgent";
import "./AppPages.css";

export type FieldType =
  | "short_text" | "long_text" | "email" | "phone" | "number" | "url" | "date" | "time"
  | "date_time" | "dropdown" | "single_choice" | "multiple_choice" | "checkbox" | "yes_no"
  | "rating" | "opinion_scale" | "nps" | "ranking" | "file_upload" | "signature" | "image_choice"
  | "address" | "name" | "matrix" | "hidden" | "payment" | "scheduling";

export type Question = {
  id: string;
  type: FieldType;
  title: string;
  description?: string | null;
  required?: boolean;
  options?: string[];
  settings?: Record<string, any>;
  logic?: { whenQuestionId?: string; operator?: "equals" | "not_equals"; value?: string } | null;
};
export type Theme = { accent?: string; background?: string; font?: string; radius?: string };
export type FormDoc = {
  id: string | number;
  title: string;
  description?: string | null;
  slug?: string | null;
  published?: boolean;
  isPublished?: boolean;
  status?: string;
  questions: Question[];
  theme?: Theme;
  settings?: { thankYouText?: string; redirectUrl?: string; logoUrl?: string; conversationalMode?: boolean; [key: string]: any };
  responseCount?: number;
  updatedAt?: string | Date;
};

const FIELD_TYPES: { type: FieldType; name: string; group: string }[] = [
  { type: "short_text", name: "Short text", group: "Text" },
  { type: "long_text", name: "Long text", group: "Text" },
  { type: "email", name: "Email", group: "Text" },
  { type: "phone", name: "Phone", group: "Text" },
  { type: "number", name: "Number", group: "Text" },
  { type: "url", name: "Website", group: "Text" },
  { type: "date", name: "Date", group: "Date & time" },
  { type: "time", name: "Time", group: "Date & time" },
  { type: "date_time", name: "Date and time", group: "Date & time" },
  { type: "dropdown", name: "Dropdown", group: "Choices" },
  { type: "single_choice", name: "Multiple choice", group: "Choices" },
  { type: "multiple_choice", name: "Checkboxes", group: "Choices" },
  { type: "checkbox", name: "Consent checkbox", group: "Choices" },
  { type: "yes_no", name: "Yes / no", group: "Choices" },
  { type: "rating", name: "Rating", group: "Rating" },
  { type: "opinion_scale", name: "Opinion scale", group: "Rating" },
  { type: "nps", name: "NPS", group: "Rating" },
  { type: "ranking", name: "Ranking", group: "Choices" },
  { type: "file_upload", name: "File upload", group: "More" },
  { type: "signature", name: "Signature", group: "More" },
  { type: "image_choice", name: "Picture choice", group: "Choices" },
  { type: "address", name: "Address", group: "Contact" },
  { type: "name", name: "Name", group: "Contact" },
  { type: "matrix", name: "Matrix", group: "Choices" },
  { type: "hidden", name: "Hidden field", group: "More" },
  { type: "payment", name: "Payment", group: "More" },
  { type: "scheduling", name: "Scheduling", group: "Date & time" },
];

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => { const random = Math.random() * 16 | 0; return (character === "x" ? random : (random & 3 | 8)).toString(16); });
}
function displayDate(date?: string | Date) {
  if (!date) return "Just now";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "Just now" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function prettyStatus(form: any) {
  return form?.published || form?.isPublished || form?.status === "published" ? "Published" : "Draft";
}
function normalizeForm(data: any): FormDoc | null {
  const form = data?.form ?? data;
  if (!form || typeof form !== "object") return null;
  const objectValue = (value: any) => {
    if (typeof value !== "string") return value && typeof value === "object" ? value : {};
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
  };
  const settings = objectValue(form.settings);
  const theme = objectValue(form.theme ?? settings.theme);
  const questions = Array.isArray(form.questions) ? form.questions.map((raw: any) => {
    const settings = objectValue(raw.settings);
    const logic = objectValue(raw.logic);
    return {
      ...raw,
      id: String(raw.id),
      type: raw.type === "hidden_field" ? "hidden" : raw.type,
      title: raw.title ?? raw.label ?? "Untitled question",
      required: Boolean(raw.required),
      options: raw.options ?? settings.options,
      settings,
      logic: raw.logic ? { ...logic, whenQuestionId: logic.whenQuestionId ?? logic.questionId } : null,
    };
  }) : [];
  return { ...form, published: form.published ?? form.status === "published", questions, theme, settings } as FormDoc;
}
function questionOptions(q: Question): string[] {
  const options = q.options ?? q.settings?.options;
  return Array.isArray(options) ? options.map(String) : ["Option 1", "Option 2", "Option 3"];
}
function shouldShowQuestion(question: Question, answers: Record<string, any>) {
  if (!question.logic?.whenQuestionId) return true;
  const prior = answers[question.logic.whenQuestionId];
  const lhs = Array.isArray(prior) ? prior.join(", ") : String(prior ?? "");
  const rhs = String(question.logic.value ?? "");
  return question.logic.operator === "not_equals" ? lhs !== rhs : lhs === rhs;
}
function saveCsv(filename: string, columns: string[], rows: string[][]) {
  const csv = [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function CoFormsLogo({ small = false }: { small?: boolean }) {
  return (
    <span className={`sf-brand ${small ? "sf-brand-small" : ""}`}>
      <img
        src="/logo.png"
        alt="CoForms"
        style={{
          width: small ? 18 : 28,
          height: small ? 18 : 28,
          objectFit: "contain",
          borderRadius: small ? 4 : 6,
          flexShrink: 0,
        }}
      />
      <span>coforms</span>
    </span>
  );
}

export const SpaceFormLogo = CoFormsLogo;

const DASHBOARD_TEMPLATES: Array<{ title: string; description: string; questions: Array<{ type: FieldType; title: string; required?: boolean; options?: string[] }> }> = [
  {
    title: "Customer feedback",
    description: "Collect clear feedback about a recent customer experience.",
    questions: [
      { type: "rating", title: "How would you rate your experience?", required: true },
      { type: "single_choice", title: "What went well?", options: ["The product", "Customer support", "Ease of use", "Other"] },
      { type: "long_text", title: "What could we improve?" },
    ],
  },
  {
    title: "Event RSVP",
    description: "Find out who is coming and what attendees need.",
    questions: [
      { type: "name", title: "What is your name?", required: true },
      { type: "email", title: "What is your email address?", required: true },
      { type: "yes_no", title: "Will you attend?", required: true },
      { type: "short_text", title: "Do you have any dietary requirements?" },
    ],
  },
  {
    title: "Project intake",
    description: "Gather the details needed to get a new project started.",
    questions: [
      { type: "short_text", title: "What is the project called?", required: true },
      { type: "long_text", title: "What would you like to accomplish?", required: true },
      { type: "date", title: "When would you like to get started?" },
      { type: "email", title: "Where can we reach you?", required: true },
    ],
  },
];

function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  const [location, setLocation] = useLocation();
  const queryString = useSearch();
  const utils = trpc.useUtils();
  const account = trpc.auth.me.useQuery(undefined, { retry: false });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => { utils.auth.me.setData(undefined, null); setLocation("/"); },
    onError: error => toast.error(error.message),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const activeTab = new URLSearchParams(queryString).get("tab");
  const nav = [
    { href: "/dashboard", label: "My forms", icon: LayoutDashboard },
    { href: "/dashboard?tab=templates", label: "Templates", icon: FileText },
    { href: "/dashboard?tab=analytics", label: "Analytics", icon: BarChart3 },
    { href: "/dashboard?tab=settings", label: "Settings", icon: Settings2 },
  ];
  const initials = (account.data?.name || account.data?.email || "A").trim().slice(0, 1).toUpperCase();
  return <div className="sf-app-shell">
    <aside className={`sf-sidebar ${menuOpen ? "sf-sidebar-open" : ""}`}>
      <div className="sf-sidebar-top"><Link href="/dashboard"><SpaceFormLogo /></Link><button className="sf-icon-btn sf-mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="sf-workspace-select"><span className="sf-workspace-icon"><img src="/logo.png" alt="" style={{ width: 20, height: 20, objectFit: "contain" }} /></span><span><b>My workspace</b><small>Starter plan</small></span></div>
      <div className="sf-nav-label">WORKSPACE</div>
      <nav className="sf-side-nav">{nav.map(item => {
        const tab = item.href.split("tab=")[1];
        const active = tab ? activeTab === tab : location === item.href && !activeTab;
        return <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setMenuOpen(false)}><item.icon size={17} /><span>{item.label}</span></Link>;
      })}</nav>
      <div className="sf-sidebar-grow" />
      <div className="sf-upgrade-card"><span className="sf-upgrade-kicker"><Sparkles size={13} /> A little more room</span><b>Get more from your forms.</b><p>Unlock unlimited AI drafts and your own branding.</p><Link href="/pricing" className="sf-small-dark-btn">Explore Pro <ArrowRight size={14} /></Link></div>
      <button className="sf-account-row" onClick={() => logout.mutate()} disabled={logout.isPending} aria-label="Sign out">
        <span className="sf-avatar">{initials}</span>
        <span><b>{account.data?.name || "My account"}</b><small>{logout.isPending ? "Signing out…" : account.data?.email || "Sign out"}</small></span>
        {logout.isPending ? <LoaderCircle size={15} className="sf-spin" /> : <LogOut size={15} />}
      </button>
    </aside>
    {menuOpen && <button className="sf-nav-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
    <main className="sf-app-main">
      <header className="sf-app-topbar"><button className="sf-icon-btn sf-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={19} /></button><div className="sf-app-crumb">Workspace <ChevronRight size={13} /> <b>{title}</b></div><div className="sf-app-top-actions"><Link href="/" className="sf-view-site"><ExternalLink size={14} /> View website</Link><span className="sf-avatar sf-avatar-sm" aria-label={account.data?.name || "Account"}>{initials}</span></div></header>
      <div className="sf-app-content">{children}</div>
    </main>
  </div>;
}

function AuthFrame({ children, heading, points }: { children: React.ReactNode; heading: string; points: string[] }) {
  return <div className="sf-auth-frame"><aside className="sf-auth-aside"><Link href="/"><SpaceFormLogo /></Link><div className="sf-auth-promise"><h2>{heading}</h2><ul>{points.map(point => <li key={point}><Check size={16} />{point}</li>)}</ul></div><small>© 2026 CoForms</small></aside><section className="sf-auth-content">{children}</section></div>;
}

export function AuthScreen({ mode = "login" }: { mode?: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const [, setLocation] = useLocation();
  const requestedNext = new URLSearchParams(window.location.search).get("next");
  const afterAuth = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard";
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  useEffect(() => { if (me.data) setLocation(afterAuth); }, [me.data, afterAuth, setLocation]);
  const signup = trpc.auth.signup.useMutation({
    onSuccess: async () => { await utils.auth.me.invalidate(); setLocation(afterAuth); },
    onError: e => setError(e.message),
  });
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => { await utils.auth.me.invalidate(); setLocation(afterAuth); },
    onError: e => setError(e.message),
  });
  const googleEnabled = trpc.auth.googleEnabled.useQuery(undefined, { retry: false });
  const busy = signup.isPending || login.isPending;
  function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (isSignup) {
      if (password.length < 12) { setError("Use at least 12 characters for your password."); return; }
      if (password !== confirm) { setError("Those passwords do not match."); return; }
      signup.mutate({ name, email, password });
    } else login.mutate({ email, password });
  }
  const points = isSignup
    ? ["Build forms in your workspace", "27 question types, from short text to scheduling", "Share public links with respondents", "Export response data as CSV"]
    : ["Every form, draft or live, in one dashboard", "Responses land the moment someone submits", "Per-question completion — see where people quit"];
  return <AuthFrame heading={isSignup ? "Start collecting responses today" : "Your forms are exactly where you left them"} points={points}>
    <div className="sf-auth-card"><Link href="/" className="sf-auth-mobile-brand"><SpaceFormLogo /></Link><div className="sf-auth-heading"><h1>{isSignup ? "Join CoForms" : "Sign in to CoForms"}</h1><p>{isSignup ? "Create an account to start building forms." : "Enter your credentials below to continue."}</p></div>
      <button className="sf-google-btn" onClick={() => { if (googleEnabled.data?.enabled) window.location.assign("/api/auth/google"); else toast.message("Google sign-in", { description: "Connect Google OAuth credentials to enable this option." }); }}><span className="sf-google-g">G</span>Continue with Google</button>
      {!googleEnabled.isLoading && !googleEnabled.data?.enabled && <p className="sf-provider-note">{googleEnabled.data?.message ?? "Google sign-in needs provider credentials before it can be enabled."}</p>}
      <div className="sf-or"><span />or continue with email<span /></div>
      <form onSubmit={submit} className="sf-auth-form">
        {isSignup && <label>Full Name<input autoComplete="name" placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} required /></label>}
        <label>Email<input autoComplete="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password{!isSignup && <Link href="/forgot-password" className="sf-forgot">Forgot?</Link>}<input autoComplete={isSignup ? "new-password" : "current-password"} type="password" placeholder={isSignup ? "At least 12 characters" : "••••••••"} value={password} onChange={e => setPassword(e.target.value)} minLength={isSignup ? 12 : 1} required /></label>
        {isSignup && <label>Confirm Password<input autoComplete="new-password" type="password" placeholder="Repeat password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></label>}
        {error && <div className="sf-form-error" role="alert">{error}</div>}
        <button className="sf-primary-btn sf-auth-submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="sf-spin" /> : null}{isSignup ? "Create free account" : "Sign in"}</button>
      </form>
      {isSignup ? <p className="sf-auth-legal">By creating an account, you agree to our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>, and confirm you’re at least 18.</p> : <p className="sf-auth-legal">New to CoForms? Continuing with Google creates an account: you agree to our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>}
      <p className="sf-auth-switch">{isSignup ? "Already have an account?" : "Don't have an account?"} <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Sign up free"}</Link></p>
    </div>
  </AuthFrame>;
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const resetStatus = trpc.auth.passwordResetEnabled.useQuery(undefined, { retry: false });
  const requestReset = trpc.auth.requestPasswordReset.useMutation();
  const enabled = Boolean(resetStatus.data?.enabled);
  return <AuthFrame heading={enabled ? "Reset your password" : "Password recovery unavailable"} points={["Reset links expire after 30 minutes", "Your existing sessions are signed out after a reset"]}>
    <div className="sf-auth-card"><Link href="/"><SpaceFormLogo /></Link><div className="sf-auth-heading"><h1>{enabled ? "Reset your password" : "Password recovery unavailable"}</h1><p>{enabled ? "Enter your account email and we’ll send a secure reset link if an account matches." : "Password reset email delivery is not configured yet. You can still sign in with your current password."}</p></div>
      {resetStatus.isLoading && <p role="status">Checking password recovery availability…</p>}
      {resetStatus.isError && <p className="sf-form-error" role="alert">Could not check password recovery availability. Please try again later.</p>}
      {enabled && <form className="sf-auth-form" onSubmit={event => { event.preventDefault(); requestReset.mutate({ email }); }}>
        <label>Email<input autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
        {requestReset.data && <p role="status">{requestReset.data.message}</p>}
        {requestReset.error && <p className="sf-form-error" role="alert">{requestReset.error.message}</p>}
        <button className="sf-primary-btn sf-auth-submit" disabled={requestReset.isPending}>{requestReset.isPending ? <LoaderCircle size={17} className="sf-spin" /> : null}Send reset link</button>
      </form>}
      <p className="sf-auth-switch"><Link href="/login">Back to sign in</Link></p>
    </div>
  </AuthFrame>;
}

export function ResetPassword() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const resetPassword = trpc.auth.resetPassword.useMutation();
  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  }, []);

  return <AuthFrame heading="Choose a new password" points={["Use at least 12 characters", "This link can only be used once"]}>
    <div className="sf-auth-card"><Link href="/"><SpaceFormLogo /></Link><div className="sf-auth-heading"><h1>Choose a new password</h1><p>Set a new password for your CoForms account.</p></div>
      {!token && <p className="sf-form-error" role="alert">This reset link is missing or invalid. Request a new one to continue.</p>}
      {resetPassword.data?.success ? <div><p role="status">Your password has been updated. Sign in with your new password.</p><p className="sf-auth-switch"><Link href="/login">Back to sign in</Link></p></div> : token && <form className="sf-auth-form" onSubmit={event => {
        event.preventDefault();
        setError("");
        if (password !== confirm) { setError("Those passwords do not match."); return; }
        resetPassword.mutate({ token, password });
      }}>
        <label>New password<input autoComplete="new-password" type="password" minLength={12} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <label>Confirm new password<input autoComplete="new-password" type="password" minLength={12} maxLength={200} value={confirm} onChange={event => setConfirm(event.target.value)} required /></label>
        {error && <p className="sf-form-error" role="alert">{error}</p>}
        {resetPassword.error && <p className="sf-form-error" role="alert">{resetPassword.error.message}</p>}
        <button className="sf-primary-btn sf-auth-submit" disabled={resetPassword.isPending}>{resetPassword.isPending ? <LoaderCircle size={17} className="sf-spin" /> : null}Update password</button>
      </form>}
    </div>
  </AuthFrame>;
}

export function Dashboard() {
  const [, setLocation] = useLocation();
  const queryString = useSearch();
  const formsQuery = trpc.forms.list.useQuery();
  const create = trpc.forms.create.useMutation({
    onSuccess: form => {
      if (!form?.id) {
        toast.error("Your form was created, but we couldn’t open it. Refresh your forms and try again.");
        void formsQuery.refetch();
        return;
      }
      setLocation(`/forms/${form.id}`);
    },
    onError: error => toast.error(error.message),
  });
  const createTemplateForm = trpc.forms.create.useMutation();
  const updateTemplateForm = trpc.forms.update.useMutation();
  const accountQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [creatingTemplate, setCreatingTemplate] = useState("");
  const items = Array.isArray(formsQuery.data) ? formsQuery.data as any[] : ((formsQuery.data as any)?.forms ?? []);
  const totalResponses = items.reduce((sum: number, form: any) => sum + Number(form.responseCount ?? form.responsesCount ?? 0), 0 as number);
  const tab = new URLSearchParams(queryString).get("tab");
  const dashboardTab = tab === "templates" || tab === "analytics" || tab === "settings" ? tab : "forms";
  const filteredItems = items.filter((form: any) => {
    const matchesStatus = statusFilter === "all" || prettyStatus(form).toLowerCase() === statusFilter;
    return matchesStatus && String(form.title ?? "").toLowerCase().includes(search.trim().toLowerCase());
  });

  async function useTemplate(template: (typeof DASHBOARD_TEMPLATES)[number]) {
    setCreatingTemplate(template.title);
    let createdId: string | undefined;
    try {
      const form = await createTemplateForm.mutateAsync({ title: template.title, description: template.description });
      if (!form?.id) throw new Error("The form was created but could not be opened. Refresh your forms and try again.");
      createdId = String(form.id);
      await updateTemplateForm.mutateAsync({
        id: createdId,
        title: template.title,
        description: template.description,
        questions: template.questions.map(question => ({
          id: makeId(),
          type: question.type,
          title: question.title,
          required: question.required ?? false,
          options: question.options,
          settings: question.options ? { options: question.options } : {},
        })),
        theme: {},
        settings: {},
      });
      setLocation(`/forms/${createdId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the template.");
      if (createdId) setLocation(`/forms/${createdId}`);
    } finally {
      setCreatingTemplate("");
    }
  }

  const title = dashboardTab === "templates" ? "Templates" : dashboardTab === "analytics" ? "Analytics" : dashboardTab === "settings" ? "Settings" : "My forms";
  return <AppShell title={title}>
    {dashboardTab === "forms" && <>
      <div className="sf-page-header"><div><div className="sf-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</div><h1>Your forms</h1><p>Everything you’re building, all in one place.</p></div><button className="sf-primary-btn" onClick={() => create.mutate({ title: "Untitled form" })} disabled={create.isPending}><Plus size={17} /> {create.isPending ? "Creating…" : "Create a form"}</button></div>
      <div className="sf-metric-row"><div className="sf-metric-card"><span>Forms</span><b>{formsQuery.isError || formsQuery.isLoading ? "—" : items.length}</b><small>Across your workspace</small></div><div className="sf-metric-card"><span>Responses</span><b>{formsQuery.isError || formsQuery.isLoading ? "—" : totalResponses}</b><small>Collected to date</small></div><div className="sf-metric-card"><span>Plan</span><b>Starter</b><small><Link href="/pricing">See upgrade options <ArrowRight size={12} /></Link></small></div></div>
      <section className="sf-section-block"><div className="sf-section-heading"><div><h2>Recent forms</h2><p>Your forms, from first draft to live link.</p></div><div className="sf-list-controls">
        <label className="sf-dashboard-search"><Search size={15} /><input type="search" aria-label="Search forms" placeholder="Search forms" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label className="sf-dashboard-filter" aria-label="Filter forms by status"><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All forms</option><option value="draft">Drafts</option><option value="published">Published</option></select><ChevronDown size={14} aria-hidden="true" /></label>
      </div></div>
        {formsQuery.isLoading ? <div className="sf-loading" role="status"><LoaderCircle className="sf-spin" /> Loading your forms…</div>
          : formsQuery.isError ? <div className="sf-request-error" role="alert"><p>We couldn’t load your forms. Check your connection and try again.</p><button className="sf-outline-btn" onClick={() => void formsQuery.refetch()}>Try again</button></div>
          : items.length === 0 ? <div className="sf-empty"><span className="sf-empty-icon"><FilePlus2 size={24} /></span><h3>Your first form starts here.</h3><p>Start with a blank page or choose a ready-made template.</p><button className="sf-primary-btn" onClick={() => create.mutate({ title: "Untitled form" })} disabled={create.isPending}><Plus size={16} /> Create your first form</button><Link href="/dashboard?tab=templates" className="sf-text-link">Browse templates <ArrowRight size={14} /></Link></div>
          : filteredItems.length === 0 ? <div className="sf-empty sf-empty-compact"><h3>No forms match those filters.</h3><p>Try another search or show all forms.</p><button className="sf-outline-btn" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Clear filters</button></div>
          : <div className="sf-form-list">{filteredItems.map((form: any) => <div className="sf-form-row" key={form.id}><Link href={`/forms/${form.id}`} className="sf-form-row-main"><span className="sf-doc-icon"><FileText size={18} /></span><span><b>{form.title || "Untitled form"}</b><small>Edited {displayDate(form.updatedAt)} · {form.responseCount ?? 0} responses</small></span></Link><span className={`sf-status ${prettyStatus(form).toLowerCase()}`}><i />{prettyStatus(form)}</span><Link href={`/forms/${form.id}/responses`} className="sf-row-action">View responses <ArrowRight size={14} /></Link><Link href={`/forms/${form.id}`} className="sf-icon-btn" aria-label={`Edit ${form.title}`}><ArrowRight size={16} /></Link></div>)}</div>}
      </section>
      <section className="sf-template-strip"><div><span className="sf-eyebrow">A GOOD PLACE TO BEGIN</span><h2>Skip the blank page.</h2><p>Start with a template, or let AI give your idea some shape.</p></div><Link href="/dashboard?tab=templates" className="sf-text-link">Browse templates <ArrowRight size={14} /></Link></section>
    </>}

    {dashboardTab === "templates" && <section className="sf-section-block">
      <div className="sf-page-header"><div><h1>Start with a template</h1><p>Choose a starting point. You can edit every question before publishing.</p></div></div>
      <div className="sf-dashboard-template-grid">{DASHBOARD_TEMPLATES.map(template => <article className="sf-dashboard-template-card" key={template.title}><span className="sf-eyebrow">{template.questions.length} STARTER QUESTIONS</span><h2>{template.title}</h2><p>{template.description}</p><ul>{template.questions.map(question => <li key={question.title}>{question.title}</li>)}</ul><button className="sf-primary-btn" onClick={() => void useTemplate(template)} disabled={Boolean(creatingTemplate)}>{creatingTemplate === template.title ? <><LoaderCircle size={15} className="sf-spin" /> Creating…</> : <>Use this template <ArrowRight size={15} /></>}</button></article>)}</div>
    </section>}

    {dashboardTab === "analytics" && <section className="sf-section-block">
      <div className="sf-page-header"><div><h1>Workspace analytics</h1><p>Response totals across your forms.</p></div></div>
      {formsQuery.isLoading ? <div className="sf-loading" role="status"><LoaderCircle className="sf-spin" /> Loading analytics…</div>
        : formsQuery.isError ? <div className="sf-request-error" role="alert"><p>We couldn’t load analytics. Check your connection and try again.</p><button className="sf-outline-btn" onClick={() => void formsQuery.refetch()}>Try again</button></div>
        : <><div className="sf-metric-row"><div className="sf-metric-card"><span>Total forms</span><b>{items.length}</b><small>{items.filter((form: any) => prettyStatus(form) === "Published").length} published</small></div><div className="sf-metric-card"><span>Submitted responses</span><b>{totalResponses}</b><small>Across all forms</small></div><div className="sf-metric-card"><span>Draft forms</span><b>{items.filter((form: any) => prettyStatus(form) === "Draft").length}</b><small>Not currently collecting responses</small></div></div>
          {items.length ? <div className="sf-form-list">{items.map((form: any) => <div className="sf-form-row" key={form.id}><Link href={`/forms/${form.id}/responses`} className="sf-form-row-main"><span className="sf-doc-icon"><BarChart3 size={18} /></span><span><b>{form.title || "Untitled form"}</b><small>{form.responseCount ?? 0} submitted responses · Edited {displayDate(form.updatedAt)}</small></span></Link><span className={`sf-status ${prettyStatus(form).toLowerCase()}`}><i />{prettyStatus(form)}</span><Link href={`/forms/${form.id}/responses`} className="sf-row-action">View responses <ArrowRight size={14} /></Link></div>)}</div>
            : <div className="sf-empty sf-empty-compact"><h3>No analytics yet.</h3><p>Create a form to see response totals here.</p><Link href="/dashboard" className="sf-outline-btn">Go to My forms</Link></div>}
        </>}
    </section>}

    {dashboardTab === "settings" && <section className="sf-section-block">
      <div className="sf-page-header"><div><h1>Account settings</h1><p>Review the account currently signed in to this workspace.</p></div></div>
      {accountQuery.isLoading ? <div className="sf-loading" role="status"><LoaderCircle className="sf-spin" /> Loading account…</div>
        : accountQuery.isError ? <div className="sf-request-error" role="alert"><p>We couldn’t load your account details.</p><button className="sf-outline-btn" onClick={() => void accountQuery.refetch()}>Try again</button></div>
        : <div className="sf-settings-card"><div><span className="sf-eyebrow">ACCOUNT NAME</span><b>{accountQuery.data?.name || "Not provided"}</b></div><div><span className="sf-eyebrow">EMAIL ADDRESS</span><b>{accountQuery.data?.email || "Not provided"}</b></div><div><span className="sf-eyebrow">SIGN-IN METHOD</span><b>{accountQuery.data?.loginMethod === "google" ? "Google" : "Email and password"}</b></div><p>Password changes and email preferences are not available yet. Sign out from the account menu when you’re finished.</p></div>}
    </section>}
  </AppShell>;
}

export function FormBuilder() {
  const [, params] = useRoute("/forms/:id");
  const id = params?.id ?? "";
  const [, setLocation] = useLocation();
  const query = trpc.forms.get.useQuery({ id }, { enabled: Boolean(id) });
  const update = trpc.forms.update.useMutation({ onSuccess: () => setSaveState("Saved") });
  const publish = trpc.forms.setPublished.useMutation({ onSuccess: () => { toast.success("Publication updated"); query.refetch(); }, onError: e => toast.error(e.message) });
  const draft = trpc.ai.generate.useMutation({ onSuccess: (generated: any) => { const draftedQuestions: Question[] = (generated.questions ?? []).map((raw: any) => ({ id: makeId(), type: raw.type === "hidden_field" ? "hidden" : raw.type, title: raw.title ?? raw.label ?? "Untitled question", description: raw.description ?? "", required: Boolean(raw.required), options: raw.options ?? raw.settings?.options, settings: raw.settings ?? {}, logic: raw.logic ? { ...raw.logic, whenQuestionId: raw.logic.whenQuestionId ?? raw.logic.questionId } : null })); setForm(prev => prev ? { ...prev, title: generated.title || prev.title, description: generated.description || prev.description, questions: draftedQuestions } : prev); setSelected(draftedQuestions[0]?.id ?? ""); setAiOpen(false); }, onError: e => toast.error(e.message) });
  const [form, setForm] = useState<FormDoc | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [tab, setTab] = useState<"build" | "design" | "logic">("build");
  const [saveState, setSaveState] = useState("Saved");
  const [shareOpen, setShareOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const initialized = useRef(false);
  const hydratedFormRef = useRef<FormDoc | null>(null);
  const saveMutationRef = useRef(update.mutateAsync);
  saveMutationRef.current = update.mutateAsync;
  const saveSchedulerRef = useRef(createDebouncedSave(
    (input: Parameters<typeof update.mutateAsync>[0]) => saveMutationRef.current(input),
    error => {
      setSaveState("Not saved");
      toast.error(error instanceof Error ? error.message : "Could not save your changes.");
    },
    650,
  ));
  const saveInFlightRef = useRef(false);
  saveInFlightRef.current = update.isPending;
  useEffect(() => {
    const normalized = normalizeForm(query.data);
    if (normalized) {
      hydratedFormRef.current = normalized;
      setForm(normalized);
      setSelected(normalized.questions[0]?.id ?? "");
      initialized.current = true;
    }
  }, [query.data]);
  useEffect(() => {
    if (!form || !initialized.current) return;
    if (form === hydratedFormRef.current) return;
    setSaveState("Saving…");
    saveSchedulerRef.current.schedule({
      id: String(form.id),
      title: form.title,
      description: form.description ?? "",
      questions: form.questions.map(question => ({ ...question, title: question.title, options: questionOptions(question), settings: { ...(question.settings ?? {}), options: questionOptions(question) } })),
      theme: form.theme ?? {},
      settings: form.settings ?? {},
    });
  }, [form]);
  useEffect(() => {
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (!saveSchedulerRef.current.isPending() && !saveInFlightRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () => {
      window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
      saveSchedulerRef.current.flush();
    };
  }, []);
  const selectedQuestion = form?.questions.find(q => q.id === selected);
  function changeQuestion(id: string, patch: Partial<Question>) {
    setForm(current => current ? { ...current, questions: current.questions.map(q => q.id === id ? { ...q, ...patch } : q) } : current);
  }
  function addQuestion(type: FieldType) {
    if (type === "payment") {
      toast.message("Payment questions are not available yet.");
      return;
    }
    const item: Question = { id: makeId(), type, title: `New ${FIELD_TYPES.find(f => f.type === type)?.name.toLowerCase() ?? "question"}`, required: false, options: ["Option 1", "Option 2", "Option 3"] };
    setForm(current => current ? { ...current, questions: [...current.questions, item] } : current); setSelected(item.id); setTab("build");
  }
  function moveQuestion(index: number, by: number) {
    setForm(current => {
      if (!current) return current;
      const next = [...current.questions]; const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, questions: next };
    });
  }
  function deleteQuestion(id: string) { setForm(current => current ? { ...current, questions: current.questions.filter(q => q.id !== id) } : current); setSelected(form?.questions.find(q => q.id !== id)?.id ?? ""); }
  if (query.isLoading) return <div className="sf-editor-loading" role="status"><LoaderCircle className="sf-spin" /> Opening your form…</div>;
  if (query.isError) return <div className="sf-editor-loading" role="alert"><div className="sf-request-error"><p>We couldn’t open this form. Check your connection and try again.</p><button className="sf-outline-btn" onClick={() => void query.refetch()}>Try again</button><Link href="/dashboard" className="sf-text-link">Back to forms</Link></div></div>;
  if (!form) return <div className="sf-editor-loading" role="alert"><div className="sf-request-error"><p>This form couldn’t be found or you don’t have access to it.</p><Link href="/dashboard" className="sf-outline-btn">Back to forms</Link></div></div>;
  const isPublished = Boolean(form.published || form.isPublished || form.status === "published");
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/f/${form.slug ?? form.id}`;
  const fields = FIELD_TYPES.reduce((groups, item) => { (groups[item.group] ||= []).push(item); return groups; }, {} as Record<string, typeof FIELD_TYPES>);
  return <div className="sf-editor-page">
    <header className="sf-editor-header"><Link href="/dashboard" className="sf-back-link"><ArrowLeft size={16} /> Back to forms</Link><div className="sf-editor-doc"><span className={`sf-status ${isPublished ? "published" : "draft"}`}><i />{isPublished ? "Published" : "Draft"}</span><span className="sf-save-state">{saveState}</span></div><div className="sf-editor-actions"><button className="sf-outline-btn" onClick={() => setAiOpen(true)}><Sparkles size={15} /> AI draft</button><button className="sf-outline-btn" onClick={() => setShareOpen(true)}><Share2 size={15} /> Share</button><button className="sf-primary-btn" onClick={() => publish.mutate({ id: String(form.id), published: !isPublished })} disabled={publish.isPending || (!isPublished && form.questions.length === 0)} title={!isPublished && form.questions.length === 0 ? "Add at least one question before publishing." : undefined}>{isPublished ? "Unpublish" : "Publish"}</button></div></header>
    {!isPublished && form.questions.length === 0 && <div className="sf-publish-hint" role="status">Add at least one question before publishing this form.</div>}
    <div className="sf-editor-body">
      <aside className="sf-builder-left"><div className="sf-builder-tabs"><button onClick={() => setTab("build")} className={tab === "build" ? "active" : ""}><FileText size={15} />Build</button><button onClick={() => setTab("design")} className={tab === "design" ? "active" : ""}><Palette size={15} />Design</button><button onClick={() => setTab("logic")} className={tab === "logic" ? "active" : ""}><Settings2 size={15} />Logic</button></div>
        {tab === "build" && <div className="sf-question-list"><div className="sf-list-caption">QUESTIONS <span>{form.questions.length}</span></div>{form.questions.map((q, index) => <button key={q.id} className={`sf-question-nav ${q.id === selected ? "active" : ""}`} onClick={() => setSelected(q.id)}><GripVertical size={14} /><span className="sf-question-number">{String(index + 1).padStart(2, "0")}</span><span className="sf-question-nav-text"><b>{q.title}</b><small>{FIELD_TYPES.find(f => f.type === q.type)?.name ?? q.type}{q.required ? " · required" : ""}</small></span></button>)}<div className="sf-add-question"><label>Add a question type<select value="" onChange={e => e.target.value && addQuestion(e.target.value as FieldType)}><option value="">Choose field…</option>{Object.entries(fields).map(([group, entries]) => <optgroup key={group} label={group}>{entries.map(field => <option key={field.type} value={field.type} disabled={field.type === "payment"}>{field.type === "payment" ? "Payment (not available yet)" : field.name}</option>)}</optgroup>)}</select></label><div className="sf-add-common">{FIELD_TYPES.slice(0, 5).map(field => <button key={field.type} title={`Add ${field.name}`} onClick={() => addQuestion(field.type)}><Plus size={12} />{field.name}</button>)}</div></div></div>}
        {tab === "design" && <div className="sf-design-panel"><span className="sf-list-caption">YOUR LOOK</span><label>Accent color<div className="sf-color-input"><input type="color" value={form.theme?.accent ?? "#e7bd45"} onChange={e => setForm(v => v ? { ...v, theme: { ...v.theme, accent: e.target.value } } : v)} /><code>{form.theme?.accent ?? "#e7bd45"}</code></div></label><label>Background<div className="sf-color-input"><input type="color" value={form.theme?.background ?? "#faf9f5"} onChange={e => setForm(v => v ? { ...v, theme: { ...v.theme, background: e.target.value } } : v)} /><code>{form.theme?.background ?? "#faf9f5"}</code></div></label><label>Typeface<select value={form.theme?.font ?? "sans"} onChange={e => setForm(v => v ? { ...v, theme: { ...v.theme, font: e.target.value } } : v)}><option value="sans">Modern sans</option><option value="serif">Editorial serif</option><option value="mono">Monospace</option></select></label><div className="sf-theme-swatches"><button onClick={() => setForm(v => v ? { ...v, theme: { accent: "#e7bd45", background: "#faf9f5", font: "sans" } } : v)}><i className="swatch-yellow" />Paper</button><button onClick={() => setForm(v => v ? { ...v, theme: { accent: "#80a98e", background: "#f5f7f3", font: "serif" } } : v)}><i className="swatch-green" />Field</button><button onClick={() => setForm(v => v ? { ...v, theme: { accent: "#a5a2d8", background: "#f7f6fb", font: "sans" } } : v)}><i className="swatch-lilac" />Soft</button></div><p className="sf-helper-copy">Color and type are saved as you edit.</p></div>}
        {tab === "logic" && <div className="sf-logic-panel"><span className="sf-list-caption">JUMP LOGIC</span><p>Show a question only when an earlier answer makes it relevant.</p>{form.questions.map(q => <div className="sf-logic-row" key={q.id}><span>{q.title}</span><select value={q.logic?.whenQuestionId ?? ""} onChange={e => changeQuestion(q.id, { logic: e.target.value ? { ...(q.logic ?? {}), whenQuestionId: e.target.value } : null })}><option value="">Always show</option>{form.questions.filter(prev => form.questions.indexOf(prev) < form.questions.indexOf(q)).map(prev => <option value={prev.id} key={prev.id}>If {prev.title}</option>)}</select>{q.logic?.whenQuestionId && <><select value={q.logic.operator ?? "equals"} onChange={e => changeQuestion(q.id, { logic: { ...q.logic, operator: e.target.value as "equals" | "not_equals" } })}><option value="equals">is</option><option value="not_equals">is not</option></select><input value={q.logic.value ?? ""} onChange={e => changeQuestion(q.id, { logic: { ...q.logic, value: e.target.value } })} placeholder="Answer value" /></>}</div>)}</div>}
      </aside>
      <section className="sf-builder-canvas"><div className="sf-builder-canvas-top"><span>FORM EDITOR</span><button className="sf-ghost-btn" onClick={() => setShareOpen(true)}><Eye size={14} /> Preview / share</button></div><div className="sf-form-canvas" style={{ background: form.theme?.background ?? "#faf9f5", "--form-accent": form.theme?.accent ?? "#e7bd45" } as React.CSSProperties}><div className="sf-form-canvas-inner"><div className="sf-step-label">YOUR FORM <span>·</span> {form.questions.length} QUESTIONS</div><input className="sf-form-title-edit" value={form.title} onChange={e => setForm(v => v ? { ...v, title: e.target.value } : v)} aria-label="Form title" placeholder="Give your form a title" /><textarea className="sf-form-description-edit" value={form.description ?? ""} onChange={e => setForm(v => v ? { ...v, description: e.target.value } : v)} placeholder="A short description helps people know what to expect." rows={2} />
        {form.questions.length === 0 && <div className="sf-canvas-empty"><FilePlus2 size={24} /><b>Your form begins with a question.</b><p>Choose one from the left to add it to the canvas.</p></div>}
        {selectedQuestion && <div className="sf-selected-question"><div className="sf-selected-header"><span><b>{String(form.questions.findIndex(q => q.id === selected) + 1).padStart(2, "0")}</b> · {FIELD_TYPES.find(f => f.type === selectedQuestion.type)?.name}</span><div><button onClick={() => moveQuestion(form.questions.findIndex(q => q.id === selected), -1)} title="Move up"><ChevronLeft size={16} /></button><button onClick={() => moveQuestion(form.questions.findIndex(q => q.id === selected), 1)} title="Move down"><ChevronRight size={16} /></button><button onClick={() => deleteQuestion(selected)} title="Delete question"><Trash2 size={15} /></button></div></div><label className="sf-edit-label">QUESTION<input value={selectedQuestion.title} onChange={e => changeQuestion(selected, { title: e.target.value })} /></label><label className="sf-edit-label">DESCRIPTION <span className="sf-muted-optional">OPTIONAL</span><textarea value={selectedQuestion.description ?? ""} onChange={e => changeQuestion(selected, { description: e.target.value })} placeholder="Add a little context…" rows={2} /></label>{["dropdown", "single_choice", "multiple_choice", "image_choice", "ranking", "matrix"].includes(selectedQuestion.type) && <label className="sf-edit-label">OPTIONS <textarea value={questionOptions(selectedQuestion).join("\n")} onChange={e => changeQuestion(selected, { options: e.target.value.split("\n").filter(Boolean) })} rows={4} placeholder="One option per line" /></label>}<label className="sf-toggle-line"><span><b>Required</b><small>People need to answer this before continuing.</small></span><input type="checkbox" checked={Boolean(selectedQuestion.required)} onChange={e => changeQuestion(selected, { required: e.target.checked })} /></label><div className="sf-question-preview"><span className="sf-preview-overline">PREVIEW</span><FieldInput question={selectedQuestion} value={undefined} onChange={() => {}} disabled /></div></div>}
        {form.questions.length > 0 && <button className="sf-canvas-add" onClick={() => addQuestion("short_text")}><Plus size={15} /> Add a question</button>}
      </div></div><div className="sf-canvas-footer"><span><span className="sf-footer-dot" /> Autosave is on</span><span>Made with <b>coforms</b></span></div></section>
      <aside className="sf-builder-inspector"><div className="sf-inspector-title"><span>FORM SETTINGS</span><MoreHorizontal size={17} /></div><label>Form name<input value={form.title} onChange={e => setForm(v => v ? { ...v, title: e.target.value } : v)} /></label><label>Intro text<textarea value={form.description ?? ""} onChange={e => setForm(v => v ? { ...v, description: e.target.value } : v)} rows={3} placeholder="Tell people what this is about" /></label><label className="sf-toggle-line"><span><b>Guided conversation mode</b><small>Offer respondents a natural AI-guided voice or text experience.</small></span><input type="checkbox" checked={Boolean(form.settings?.conversationalMode)} onChange={e => setForm(v => v ? { ...v, settings: { ...(v.settings ?? {}), conversationalMode: e.target.checked } } : v)} /></label><label>Thank-you message<textarea value={form.settings?.thankYouText ?? ""} onChange={e => setForm(v => v ? { ...v, settings: { ...(v.settings ?? {}), thankYouText: e.target.value } } : v)} rows={2} placeholder="Thanks for sharing." /></label><label>After-submit redirect<input value={form.settings?.redirectUrl ?? ""} onChange={e => setForm(v => v ? { ...v, settings: { ...(v.settings ?? {}), redirectUrl: e.target.value } } : v)} placeholder="/thanks or https://example.com/thanks" /></label><label>Logo image URL<input value={form.settings?.logoUrl ?? ""} onChange={e => setForm(v => v ? { ...v, settings: { ...(v.settings ?? {}), logoUrl: e.target.value } } : v)} placeholder="https://example.com/logo.png" /></label><p className="sf-helper-copy">Redirects accept a local path or secure HTTPS address.</p><div className="sf-inspector-summary"><span>Questions</span><b>{form.questions.length}</b></div><div className="sf-inspector-summary"><span>Responses</span><b>{form.responseCount ?? 0}</b></div><Link className="sf-inspector-link" href={`/forms/${form.id}/responses`}><BarChart3 size={15} /> View responses <ArrowRight size={14} /></Link><button className="sf-inspector-link" onClick={() => setShareOpen(true)}><Share2 size={15} /> Share your form <ArrowRight size={14} /></button><div className="sf-inspector-tip"><Sparkles size={14} /><span><b>A good form is a short one.</b><small>Keep each question focused and easy to answer.</small></span></div></aside>
    </div>
    {aiOpen && <div className="sf-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setAiOpen(false)}><section className="sf-modal"><button className="sf-modal-close" onClick={() => setAiOpen(false)}><X size={18} /></button><span className="sf-eyebrow"><WandSparkles size={13} /> AI FORM DRAFT</span><h2>What do you want to build?</h2><p>Describe your form. AI will draft the questions, order and field types.</p><textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Feedback from people who came to our Saturday baking class…" rows={4} /><button className="sf-primary-btn" disabled={!prompt.trim() || draft.isPending} onClick={() => draft.mutate({ prompt })}>{draft.isPending ? <><LoaderCircle className="sf-spin" size={16} /> Drafting…</> : <><Sparkles size={16} /> Draft my questions</>}</button><small>Your draft stays editable. No payment provider is connected.</small></section></div>}
    {shareOpen && <ShareDialog form={form} url={shareUrl} onClose={() => setShareOpen(false)} />}
  </div>;
}

function ShareDialog({ form, url, onClose }: { form: FormDoc; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { toast.error("Could not copy to clipboard."); } }
  const embed = `<iframe src="${url}" title="${form.title}" width="100%" height="600" frameborder="0"></iframe>`;
  return <div className="sf-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="sf-modal sf-share-modal"><button className="sf-modal-close" onClick={onClose}><X size={18} /></button><span className="sf-eyebrow"><Share2 size={13} /> SHARE YOUR FORM</span><h2>Ready to collect answers?</h2><p>Anyone with this link can respond. No account needed.</p>{!form.published && !form.isPublished && form.status !== "published" && <div className="sf-notice">Publish the form before the public link becomes available.</div>}<div className="sf-share-link-row"><input readOnly value={url} /><button className="sf-primary-btn" onClick={() => copy(url)}><Copy size={15} />{copied ? "Copied" : "Copy link"}</button></div><div className="sf-share-tools"><div className="sf-qr-card"><QRCodeSVG value={url || "https://coforms.io"} size={128} bgColor="#ffffff" fgColor="#191919" level="M" /><span>SCAN TO OPEN</span><button className="sf-text-link" onClick={() => { const svg = document.querySelector(".sf-qr-card svg"); if (!svg) return; const xml = new XMLSerializer().serializeToString(svg); const anchor = document.createElement("a"); anchor.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`; anchor.download = "coforms-qr.svg"; anchor.click(); }}>Download QR <Download size={13} /></button></div><div className="sf-embed-card"><b>Embed this form</b><p>Paste this snippet into your site.</p><pre>{embed}</pre><button className="sf-outline-btn" onClick={() => copy(embed)}><Clipboard size={14} /> Copy embed code</button></div></div></section></div>;
}

export function ResponsesPage() {
  const [, params] = useRoute("/forms/:id/responses");
  const id = params?.id ?? "";
  const formQuery = trpc.forms.get.useQuery({ id }, { enabled: !!id });
  const responseQuery = trpc.forms.responses.useQuery({ formId: id }, { enabled: !!id });
  const form = normalizeForm(formQuery.data);
  const result = responseQuery.data as any;
  const responses: any[] = Array.isArray(result) ? result : (result?.responses ?? []);
  const questions = normalizeForm({ ...(form ?? {}), questions: result?.questions ?? form?.questions })?.questions ?? [];
  const metrics = result?.metrics ?? {};
  const viewedByQuestion = new Map<string, number>((metrics.questionViews ?? []).map((item: any) => [item.questionId, Number(item.count)]));
  function exportResponses() {
    const headers = ["Response ID", "Submitted at", ...questions.map(q => q.title)];
    const rows = responses.map(response => {
      const answerValues = response.answers ?? response.values ?? {};
      const answerById = Array.isArray(answerValues) ? Object.fromEntries(answerValues.map((a: any) => [a.questionId ?? a.fieldId, a.value])) : answerValues;
      return [String(response.id ?? ""), String(response.submittedAt ?? response.createdAt ?? ""), ...questions.map(q => { const value = answerById[q.id]; return Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value ?? ""); })];
    });
    saveCsv(`${(form?.title || "coforms").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-responses.csv`, headers, rows);
  }
  if (formQuery.isLoading) return <AppShell title="Responses"><div className="sf-loading" role="status"><LoaderCircle className="sf-spin" /> Loading form…</div></AppShell>;
  if (formQuery.isError || !form) return <AppShell title="Responses"><div className="sf-request-error" role="alert"><p>This form couldn’t be loaded. It may have been deleted or you may not have access.</p><button className="sf-outline-btn" onClick={() => void formQuery.refetch()}>Try again</button><Link href="/dashboard" className="sf-text-link">Back to forms</Link></div></AppShell>;
  return <AppShell title="Responses"><div className="sf-page-header"><div><Link href={`/forms/${id}`} className="sf-back-link"><ArrowLeft size={14} /> Back to builder</Link><h1>{form?.title || "Responses"}</h1><p>Every answer in one place.</p></div><button className="sf-primary-btn" onClick={exportResponses} disabled={responseQuery.isLoading || responseQuery.isError || !responses.length}><Download size={16} /> Export CSV</button></div>
    {responseQuery.isLoading ? <div className="sf-loading" role="status"><LoaderCircle className="sf-spin" /> Loading responses…</div>
      : responseQuery.isError ? <div className="sf-request-error" role="alert"><p>We couldn’t load responses. Check your connection and try again.</p><button className="sf-outline-btn" onClick={() => void responseQuery.refetch()}>Try again</button></div>
      : <>
    <div className="sf-response-stats"><div><span>Started</span><b>{metrics.started ?? responses.length}</b></div><div><span>Submitted</span><b>{responses.length}</b></div><div><span>Completion rate</span><b>{metrics.completionRate ?? 0}%</b></div><div><span>Questions</span><b>{questions.length}</b></div><div><span>Form status</span><b>{form?.published ? "Published" : "Draft"}</b></div></div>
    <div className="sf-table-wrap"><table className="sf-response-table"><thead><tr><th>Submitted</th>{questions.map(q => <th key={q.id}>{q.title}</th>)}</tr></thead><tbody>{responses.map((response: any, index: number) => { const source = response.answers ?? response.values ?? {}; const byId = Array.isArray(source) ? Object.fromEntries(source.map((a: any) => [a.questionId ?? a.fieldId, a.value])) : source; return <tr key={response.id ?? index}><td>{displayDate(response.submittedAt ?? response.createdAt)}</td>{questions.map(q => <td key={q.id}>{Array.isArray(byId[q.id]) ? byId[q.id].join(", ") : typeof byId[q.id] === "object" ? JSON.stringify(byId[q.id]) : String(byId[q.id] ?? "—")}</td>)}</tr>; })}</tbody></table>{!responseQuery.isLoading && !responses.length && <div className="sf-empty sf-empty-compact"><span className="sf-empty-icon"><BarChart3 size={24} /></span><h3>Your responses will show up here.</h3><p>Publish your form and share the link to start collecting answers.</p></div>}</div>
    {questions.length > 0 && <section className="sf-section-block"><div className="sf-section-heading"><div><h2>Question summary</h2><p>Response counts and reach by question.</p></div></div><div className="sf-summary-grid">{questions.map(q => {     const count = responses.filter((r: any) => { const a = r.answers ?? r.values ?? {}; return hasResponseValue(Array.isArray(a) ? a.find((x: any) => (x.questionId ?? x.fieldId) === q.id)?.value : a[q.id]); }).length; return <div key={q.id} className="sf-summary-card"><span>{q.title}</span><b>{count} <small>of {responses.length} answered · {viewedByQuestion.get(q.id) ?? 0} reached</small></b><div className="sf-progress"><i style={{ width: `${responses.length ? count / responses.length * 100 : 0}%` }} /></div></div>; })}</div></section>}
      </>}
  </AppShell>;
}

export function FieldInput({ question, value, onChange, disabled = false, onFile }: { question: Question; value: any; onChange: (value: any) => void; disabled?: boolean; onFile?: (file: File) => Promise<void> }) {
  const options = questionOptions(question);
  const basic = (type: string, placeholder = "Your answer") => <input type={type} placeholder={placeholder} value={value ?? ""} disabled={disabled} onChange={e => onChange(e.target.value)} />;
  switch (question.type) {
    case "short_text": case "name": case "address": return basic("text", question.type === "name" ? "Your name" : question.type === "address" ? "Street address" : "Type your answer…");
    case "email": return basic("email", "you@example.com");
    case "phone": return basic("tel", "+1 (555) 000-0000");
    case "number": return basic("number", "0");
    case "url": return basic("url", "https://");
    case "date": return basic("date");
    case "time": return basic("time");
    case "date_time": case "scheduling": return basic("datetime-local");
    case "long_text": return <textarea rows={4} placeholder="Type your answer…" value={value ?? ""} disabled={disabled} onChange={e => onChange(e.target.value)} />;
    case "dropdown": return <select value={value ?? ""} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">Choose an option…</option>{options.map(o => <option key={o}>{o}</option>)}</select>;
    case "single_choice": case "image_choice": case "yes_no": {
      const choices = question.type === "yes_no" ? ["Yes", "No"] : options;
      return <div className="sf-choice-list">{choices.map((option, i) => <label className={`sf-choice ${value === option ? "selected" : ""}`} key={option}><input type="radio" name={question.id} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)} />{question.type === "image_choice" && <span className={`sf-choice-tile tile-${i % 3}`} />}{option}</label>)}</div>;
    }
    case "multiple_choice": return <div className="sf-choice-list">{options.map(option => { const selected = Array.isArray(value) ? value : []; return <label className={`sf-choice ${selected.includes(option) ? "selected" : ""}`} key={option}><input type="checkbox" checked={selected.includes(option)} disabled={disabled} onChange={e => onChange(e.target.checked ? [...selected, option] : selected.filter(item => item !== option))} />{option}</label>; })}</div>;
    case "checkbox": return <label className="sf-choice"><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={e => onChange(e.target.checked)} />I agree</label>;
    case "rating": return <div className="sf-rating-row">{[1, 2, 3, 4, 5].map(n => <button type="button" className={Number(value) >= n ? "chosen" : ""} key={n} disabled={disabled} onClick={() => onChange(n)} aria-label={`${n} out of 5`}>★</button>)}</div>;
    case "opinion_scale": return <div className="sf-scale-row">{Array.from({ length: Number(question.settings?.max ?? 5) - Number(question.settings?.min ?? 1) + 1 }, (_, i) => Number(question.settings?.min ?? 1) + i).map(n => <button type="button" className={Number(value) === n ? "chosen" : ""} key={n} disabled={disabled} onClick={() => onChange(n)}>{n}</button>)}</div>;
    case "nps": return <div className="sf-nps-grid">{Array.from({ length: 11 }, (_, n) => <button type="button" className={Number(value) === n ? "chosen" : ""} key={n} disabled={disabled} onClick={() => onChange(n)}>{n}</button>)}</div>;
    case "ranking": return <select multiple size={Math.min(options.length, 5)} value={Array.isArray(value) ? value : []} disabled={disabled} onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}>{options.map(o => <option key={o}>{o}</option>)}</select>;
    case "matrix": return <div className="sf-matrix">{(question.settings?.rows ?? ["Experience", "Value", "Support"]).map((row: string) => <div key={row}><b>{row}</b><div>{options.map(option => <label key={option}><input type="radio" name={`${question.id}-${row}`} checked={value?.[row] === option} disabled={disabled} onChange={() => onChange({ ...(value ?? {}), [row]: option })} />{option}</label>)}</div></div>)}</div>;
    case "file_upload": return <label className="sf-upload-box"><Upload size={20} /><span>{value?.name ?? "Choose a file or drag it here"}</span><small>Max 10 MB</small><input type="file" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; if (file && onFile) void onFile(file); else if (file) onChange({ name: file.name, size: file.size }); }} /></label>;
    case "signature": return <SignaturePad value={value} onChange={onChange} disabled={disabled} />;
    case "hidden": return <span className="sf-hidden-field-note">Hidden from respondents</span>;
    case "payment": return <div className="sf-payment-notice"><span>₹</span><div><b>Payment collection is unavailable</b><small>This form cannot be published while it contains a payment question.</small></div></div>;
    default: return basic("text");
  }
}

function SignaturePad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }; };
  const drawStart = (e: React.PointerEvent<HTMLCanvasElement>) => { if (disabled) return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); const ctx = canvasRef.current?.getContext("2d"); if (p && ctx) { ctx.beginPath(); ctx.moveTo(p.x, p.y); } };
  const drawMove = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const p = point(e); const ctx = canvasRef.current?.getContext("2d"); if (!p || !ctx) return; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#222"; ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const drawEnd = () => { if (!drawing.current) return; drawing.current = false; const canvas = canvasRef.current; if (canvas) onChange(canvas.toDataURL("image/png")); };
  return <div className="sf-signature-pad"><canvas ref={canvasRef} width={560} height={140} onPointerDown={drawStart} onPointerMove={drawMove} onPointerUp={drawEnd} onPointerCancel={drawEnd} />{!disabled && <button type="button" className="sf-text-link" onClick={() => { const ctx = canvasRef.current?.getContext("2d"); const c = canvasRef.current; if (ctx && c) { ctx.clearRect(0, 0, c.width, c.height); onChange(""); } }}>Clear signature</button>}</div>;
}

export function PublicForm() {
  const [, params] = useRoute("/f/:slug");
  const slug = params?.slug ?? "";
  const query = trpc.forms.bySlug.useQuery({ slug }, { enabled: Boolean(slug) });
  const submit = trpc.forms.submit.useMutation({ onSuccess: result => { if (result?.redirectUrl) window.location.assign(result.redirectUrl); else setComplete(true); }, onError: e => toast.error(e.message) });
  const prepareUpload = trpc.forms.prepareUpload.useMutation();
  const evaluateVisibility = trpc.forms.visible.useMutation();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [index, setIndex] = useState(0);
  const [complete, setComplete] = useState(false);
  const normalized = normalizeForm(query.data);
  const isConversationalConfigured = Boolean(normalized?.settings?.conversationalMode);
  const [displayMode, setDisplayMode] = useState<"interview" | "classic">("classic");
  const modeInitialized = useRef(false);
  useEffect(() => {
    if (normalized && !modeInitialized.current) {
      modeInitialized.current = true;
      if (normalized.settings?.conversationalMode) {
        setDisplayMode("interview");
      }
    }
  }, [normalized?.settings?.conversationalMode]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<{ responseId: string; progressToken: string } | null>(null);
  const startedFor = useRef("");
  const startResponse = trpc.forms.start.useMutation({ onSuccess: setProgress, onError: error => { startedFor.current = ""; toast.error(error.message); } });
  const recordProgress = trpc.forms.progress.useMutation({ onError: error => toast.error(error.message) });
  const questions = useMemo(() => normalized?.questions.filter(q => q.type !== "hidden") ?? [], [normalized]);
  const visible = visibleIds ? questions.filter(q => visibleIds.includes(q.id)) : questions;
  const current = visible[Math.min(index, Math.max(visible.length - 1, 0))];
  useEffect(() => {
    if (!normalized || !slug || startedFor.current === normalized.id) return;
    startedFor.current = String(normalized.id);
    setProgress(null);
    startResponse.mutate({ slug });
  }, [normalized?.id, slug]);
  useEffect(() => {
    if (progress && current) recordProgress.mutate({ slug, responseId: progress.responseId, progressToken: progress.progressToken, questionId: current.id });
  }, [progress?.responseId, current?.id]);
  useEffect(() => { if (questions.length && index >= visible.length) setIndex(Math.max(visible.length - 1, 0)); }, [visible.length, index, questions.length]);
  function submitAnswers() {
    if (!progress) { toast.message("Preparing your response…"); return; }
    submit.mutate({ slug, responseId: progress.responseId, progressToken: progress.progressToken, answers });
  }
  async function uploadFile(file: File) {
    if (!current) return;
    setUploadBusy(true);
    try {
      const result = await prepareUpload.mutateAsync({ slug, questionId: current.id, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size }) as any;
      const uploadUrl = result?.uploadUrl; const assetPath = result?.assetPath;
      if (!uploadUrl || !assetPath) throw new Error("File upload is not configured yet.");
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!uploaded.ok) throw new Error("The upload did not finish. Please try again.");
      setAnswers(value => ({ ...value, [current.id]: { name: file.name, path: assetPath } }));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not upload this file."); }
    finally { setUploadBusy(false); }
  }
  const isLastQuestion = index >= visible.length - 1;
  const voice = useVoiceForm({
    currentQuestion: current,
    questionOptions: current ? questionOptions(current) : [],
    onApplyAnswer: (questionId, value) => setAnswers(old => ({ ...old, [questionId]: value })),
    onNext: () => {
      if (isLastQuestion) {
        toast.info("All questions answered. Click Submit when you're ready to send your response.");
      } else {
        next();
      }
    },
    isFormComplete: complete,
  });

  async function next() {
    if (!current) { submitAnswers(); return; }
    const value = answers[current.id];
    if (current.required && (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length) || (current.type === "checkbox" && value !== true))) { toast.error("Please answer this question before continuing."); return; }
    try {
      const result = await evaluateVisibility.mutateAsync({ slug, answers });
      const nextVisible = questions.filter(question => result.questionIds.includes(question.id));
      const currentPosition = questions.findIndex(question => question.id === current.id);
      const nextIndex = nextVisible.findIndex(question => questions.findIndex(item => item.id === question.id) > currentPosition);
      setVisibleIds(nextVisible.map(question => question.id));
      if (nextIndex < 0) submitAnswers();
      else setIndex(nextIndex);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not continue this form."); }
  }

  // Voice-agent variant: receives the just-confirmed answer so it never reads
  // from a stale closure (the spoken answer may not have flushed to `answers` yet).
  async function nextAfterVoice(confirmedQuestionId?: string, confirmedValue?: unknown) {
    if (!current) { submitAnswers(); return; }
    if (confirmedQuestionId !== undefined) {
      setAnswers(old => ({ ...old, [confirmedQuestionId]: confirmedValue }));
    }
    // Build the answers map with the freshly confirmed value merged in
    const mergedAnswers = confirmedQuestionId !== undefined
      ? { ...answers, [confirmedQuestionId]: confirmedValue }
      : answers;
    try {
      const result = await evaluateVisibility.mutateAsync({ slug, answers: mergedAnswers });
      const nextVisible = questions.filter(question => result.questionIds.includes(question.id));
      const currentPosition = questions.findIndex(question => question.id === current.id);
      const nextIndex = nextVisible.findIndex(question => questions.findIndex(item => item.id === question.id) > currentPosition);
      setVisibleIds(nextVisible.map(question => question.id));
      if (nextIndex < 0) submitAnswers();
      else setIndex(nextIndex);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check which question comes next. Please try again.");
    }
  }

  if (query.isLoading) return <div className="sf-public-loading"><LoaderCircle className="sf-spin" /> Opening your form…</div>;
  if (!normalized) return <div className="sf-form-not-found"><SpaceFormLogo /><h1>This form isn’t available.</h1><p>Check the link and try again.</p></div>;
  if (complete && displayMode !== "interview") return <div className="sf-public-form" style={{ background: normalized.theme?.background ?? "#faf9f5" }}><div className="sf-public-card sf-complete-card"><span className="sf-complete-check"><Check size={22} /></span><span className="sf-eyebrow">RESPONSE RECORDED</span><h1>{normalized.settings?.thankYouText || "Thanks for sharing."}</h1><p>Your answer has been sent.</p><span className="sf-powered-by">Made with <SpaceFormLogo small /></span></div></div>;
  if (!current && !complete) return <div className="sf-form-not-found"><SpaceFormLogo /><h1>This form has no questions yet.</h1><p>Come back when it’s ready.</p></div>;

  if (displayMode === "interview" && isConversationalConfigured) {
    return (
      <InteractiveVoiceAgent
        slug={slug}
        responseId={progress?.responseId}
        progressToken={progress?.progressToken}
        form={normalized}
        questions={questions}
        visible={visible}
        answers={answers}
        onAnswerChange={(questionId, value) => setAnswers(old => ({ ...old, [questionId]: value }))}
        currentIndex={index}
        onNext={nextAfterVoice}
        onBack={() => setIndex(i => Math.max(0, i - 1))}
        onJumpToQuestion={(targetIdx) => setIndex(targetIdx)}
        onSubmit={submitAnswers}
        isSubmitting={submit.isPending}
        isEvaluating={evaluateVisibility.isPending}
        onSwitchToClassic={() => setDisplayMode("classic")}
        uploadFile={uploadFile}
        uploadBusy={uploadBusy}
        FieldInputComponent={FieldInput}
        isComplete={complete}
      />
    );
  }

  return (
    <div className="sf-public-form" style={{ background: normalized.theme?.background ?? "#faf9f5", "--form-accent": normalized.theme?.accent ?? "#e7bd45" } as React.CSSProperties}>
      <header className="sf-public-brand">{normalized.settings?.logoUrl ? <img src={normalized.settings.logoUrl} alt={`${normalized.title} logo`} /> : <SpaceFormLogo />}</header>
      <main className="sf-public-card">
        <div className="sf-voice-header-bar">
          <div className="sf-public-progress">
            <span>QUESTION {String(index + 1).padStart(2, "0")} <i>/</i> {String(visible.length).padStart(2, "0")}</span>
            <div><i style={{ width: `${Math.min(100, (index + 1) / Math.max(visible.length, 1) * 100)}%` }} /></div>
          </div>
          <div className="sf-voice-controls">
            {isConversationalConfigured && (
              <button
                type="button"
                className="sf-voice-toggle-btn active"
                onClick={() => setDisplayMode("interview")}
                title="Switch to guided voice form"
                style={{ background: "linear-gradient(180deg, #fef08a 0%, #efc54a 100%)", color: "#141312", fontWeight: 600 }}
              >
                <Sparkles size={13} />
                <span>Guided voice form</span>
              </button>
            )}
            {voice.isSupported ? (
              <>
                <button
                  type="button"
                  className={`sf-voice-toggle-btn ${voice.isEnabled ? "active" : ""}`}
                  onClick={voice.toggleVoiceMode}
                  title={voice.isEnabled ? "Turn off voice assistant" : "Turn on voice assistant"}
                  aria-pressed={voice.isEnabled}
                  aria-label={voice.isEnabled ? "Turn off voice assistant" : "Turn on voice assistant"}
                >
                  {voice.isEnabled ? <Mic size={14} className="sf-voice-mic-active" /> : <MicOff size={14} />}
                  <span>
                    {voice.isEnabled
                      ? voice.status === "listening"
                        ? "Listening…"
                        : voice.status === "speaking"
                        ? "Speaking…"
                        : "Voice on"
                      : "Voice mode"}
                  </span>
                </button>
                {voice.isEnabled && (
                  <button
                    type="button"
                    className="sf-voice-icon-btn"
                    onClick={voice.toggleMute}
                    title={voice.isMuted ? "Unmute assistant voice" : "Mute assistant voice"}
                    aria-label={voice.isMuted ? "Unmute assistant voice" : "Mute assistant voice"}
                  >
                    {voice.isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                )}
              </>
            ) : (
              <span className="sf-voice-unsupported-note" title="Speech recognition is not available in this browser. Type and click as usual.">
                Voice unavailable
              </span>
            )}
          </div>
        </div>

        {voice.proposedAnswer && (
          <div className="sf-voice-confirm-banner" role="region" aria-label="Confirm voice response">
            <div className="sf-voice-confirm-info">
              <span className="sf-voice-confirm-pulse" />
              <span>Interpreted: <b>"{voice.proposedAnswer.displayValue}"</b></span>
            </div>
            {voice.proposedAnswer.message && (
              <p className="sf-voice-confirm-note">{voice.proposedAnswer.message}</p>
            )}
            <div className="sf-voice-confirm-actions">
              {!voice.proposedAnswer.isAmbiguous && (
                <button
                  type="button"
                  className="sf-voice-btn-confirm"
                  onClick={voice.confirmAnswer}
                  aria-label="Confirm answer and continue"
                >
                  <Check size={14} /> Confirm & Continue
                </button>
              )}
              <button
                type="button"
                className="sf-voice-btn-retry"
                onClick={voice.retryAnswer}
                aria-label="Try again or edit"
              >
                <X size={14} /> Try again / Edit
              </button>
            </div>
          </div>
        )}

        {voice.errorMessage && (
          <div className="sf-voice-error-banner" role="alert">
            <span>{voice.errorMessage}</span>
            {voice.isEnabled && (
              <button type="button" onClick={voice.startListening} className="sf-voice-retry-link">
                Retry microphone
              </button>
            )}
          </div>
        )}

        {index === 0 && <><h1 className="sf-public-title">{normalized.title}</h1>{normalized.description && <p className="sf-public-intro">{normalized.description}</p>}</>}
        <section className="sf-public-question">
          <h2>{current.title}{current.required && <span> *</span>}</h2>
          {current.description && <p>{current.description}</p>}
          <div className="sf-public-field">
            <FieldInput question={current} value={answers[current.id]} onChange={v => setAnswers(old => ({ ...old, [current.id]: v }))} onFile={uploadFile} />
          </div>
        </section>
        <div className="sf-public-actions">
          <span>{index > 0 ? <button className="sf-public-back" onClick={() => setIndex(i => Math.max(0, i - 1))}><ChevronLeft size={15} /> Back</button> : <span className="sf-required-note">* Required</span>}</span>
          <button className="sf-primary-btn" onClick={next} disabled={submit.isPending || uploadBusy || evaluateVisibility.isPending || startResponse.isPending || !progress}>
            {submit.isPending || evaluateVisibility.isPending || startResponse.isPending ? <LoaderCircle size={16} className="sf-spin" /> : null}
            {index >= visible.length - 1 ? "Submit" : "Continue"}
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="sf-public-footer">
          <span>Press <kbd>Enter ↵</kbd> to continue</span>
          <span>{index + 1} of {visible.length}</span>
        </div>
      </main>
      <div className="sf-powered-by">Made with <SpaceFormLogo small /></div>
    </div>
  );
}

export function NewForm() {
  const [, setLocation] = useLocation();
  const started = useRef(false);
  const create = trpc.forms.create.useMutation({
    onSuccess: form => setLocation(`/forms/${(form as any).id}`),
    onError: error => { started.current = false; toast.error(error.message); },
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create.mutate({ title: "Untitled form" });
  }, []);
  if (create.isError) return <div className="sf-editor-loading" role="alert"><div className="sf-request-error"><p>We couldn’t create your draft. Check your connection and try again.</p><button className="sf-primary-btn" onClick={() => { started.current = true; create.reset(); create.mutate({ title: "Untitled form" }); }}>Try again</button><Link href="/dashboard" className="sf-text-link">Back to forms</Link></div></div>;
  return <div className="sf-editor-loading" role="status"><LoaderCircle className="sf-spin" /> Creating a draft…</div>;
}
