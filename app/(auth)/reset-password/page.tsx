import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold text-foreground">Set new password</h1>
      <p className="mt-1 text-sm text-muted">
        Enter your new password below.
      </p>
      <div className="mt-5">
        <ResetPasswordForm />
      </div>
    </>
  );
}
