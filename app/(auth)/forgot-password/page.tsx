import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">
        Enter your email and we&apos;ll send you a reset link.
      </p>
      <div className="mt-5">
        <ForgotPasswordForm />
      </div>
    </>
  );
}
