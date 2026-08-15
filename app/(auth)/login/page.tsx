import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SiroQ" };

export default function LoginPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Welcome back</h2>
        <p className="mt-0.5 text-sm text-muted">Sign in to continue to your datasets.</p>
      </div>
      <LoginForm />
    </div>
  );
}
