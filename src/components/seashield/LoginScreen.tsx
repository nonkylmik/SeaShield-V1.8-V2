import { useState, type FormEvent } from "react";
import { Anchor, LockKeyhole } from "lucide-react";

export function LoginScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border bg-panel shadow-panel">
        <header className="border-b border-border bg-panel-header px-5 py-4">
          <div className="flex items-center gap-2 text-signal">
            <Anchor className="size-5" />
            <span className="font-mono text-sm font-semibold tracking-[0.16em]">SEASHIELD</span>
          </div>
          <h1 className="mt-4 text-lg font-semibold">Operator sign-in</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Authenticated access is required for this console.
          </p>
        </header>
        <form onSubmit={submit} className="space-y-3 p-5">
          <label className="grid gap-1 text-xs">
            <span className="label-mono">Email</span>
            <input
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 border border-input bg-background px-2"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="label-mono">Password</span>
            <input
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 border border-input bg-background px-2"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="border border-critical/50 bg-critical/10 px-2 py-1.5 text-xs text-critical"
            >
              {error}
            </p>
          ) : null}
          <button
            disabled={busy}
            className="inline-flex h-9 w-full items-center justify-center gap-2 border border-signal/50 bg-signal/10 text-xs font-semibold text-signal hover:bg-signal/20 disabled:opacity-50"
          >
            <LockKeyhole className="size-3.5" />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
