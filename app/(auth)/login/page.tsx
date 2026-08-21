import { LoginForm } from "./login-form";
import { Trans } from "@/components/trans";

export const metadata = { title: "Sign in · SiroQ" };

export default function LoginPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          <Trans k="auth.signInTitle" />
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          <Trans k="auth.signInSubtitle" />
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
