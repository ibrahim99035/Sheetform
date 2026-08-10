import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Sheetform" };

export default function LoginPage() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900">Sign in</h2>
      <LoginForm />
    </div>
  );
}
