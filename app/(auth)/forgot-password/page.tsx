import { ForgotPasswordForm } from "./forgot-password-form";
import { Trans } from "@/components/trans";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold text-foreground">
        <Trans k="auth.forgotTitle" />
      </h1>
      <p className="mt-1 text-sm text-muted">
        <Trans k="auth.forgotSubtitle" />
      </p>
      <div className="mt-5">
        <ForgotPasswordForm />
      </div>
    </>
  );
}
