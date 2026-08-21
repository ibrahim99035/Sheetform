import { SignupForm } from "./signup-form";
import { Trans } from "@/components/trans";

export const metadata = { title: "Create account · SiroQ" };

export default function SignupPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          <Trans k="auth.signUpTitle" />
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          <Trans k="auth.signUpSubtitle" />
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
