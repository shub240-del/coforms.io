import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthScreen, Dashboard, ForgotPassword, FormBuilder, NewForm, PublicForm, ResponsesPage } from "./pages/AppPages";
import { LegalPage, MarketingHome, MarketingPage } from "./pages/Marketing";
import { trpc } from "./lib/trpc";

function ProtectedPage({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const session = trpc.auth.me.useQuery(undefined, { retry: false });

  useEffect(() => {
    if (session.isLoading || session.error || session.data) return;
    const next = `${window.location.pathname}${window.location.search}`;
    setLocation(`/login?next=${encodeURIComponent(next)}`);
  }, [session.data, session.error, session.isLoading, setLocation]);

  if (session.isLoading) return <div className="sf-editor-loading" role="status">Checking your session…</div>;
  if (session.error) {
    return (
      <div className="sf-editor-loading" role="alert">
        <p>We couldn’t verify your session. Check your connection and try again.</p>
        <button type="button" onClick={() => void session.refetch()}>Try again</button>
      </div>
    );
  }
  if (!session.data) return null;
  return children;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={MarketingHome} />
      <Route path="/features" component={() => <MarketingPage section="features" />} />
      <Route path="/templates" component={() => <MarketingPage section="templates" />} />
      <Route path="/pricing" component={() => <MarketingPage section="pricing" />} />
      <Route path="/faq" component={() => <MarketingPage section="faq" />} />
      <Route path="/privacy" component={() => <LegalPage kind="privacy" />} />
      <Route path="/terms" component={() => <LegalPage kind="terms" />} />
      <Route path="/refund" component={() => <LegalPage kind="refund" />} />
      <Route path="/signup" component={() => <AuthScreen mode="signup" />} />
      <Route path="/login" component={() => <AuthScreen mode="login" />} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/dashboard" component={() => <ProtectedPage><Dashboard /></ProtectedPage>} />
      <Route path="/forms/new" component={() => <ProtectedPage><NewForm /></ProtectedPage>} />
      <Route path="/forms/:id/responses" component={() => <ProtectedPage><ResponsesPage /></ProtectedPage>} />
      <Route path="/forms/:id" component={() => <ProtectedPage><FormBuilder /></ProtectedPage>} />
      <Route path="/f/:slug" component={PublicForm} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
