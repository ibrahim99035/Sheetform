import { ResetPasswordForm } from "./reset-password-form";
import { Trans } from "@/components/trans";

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold text-foreground">
        <Trans k="auth.resetTitle" />
      </h1>
      <p className="mt-1 text-sm text-muted">
        <Trans k="auth.resetSubtitle" />
      </p>
      <div className="mt-5">
        <ResetPasswordForm />
      </div>
    </>
  );
}
