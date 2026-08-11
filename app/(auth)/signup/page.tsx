import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account · Sheetform" };

export default function SignupPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Create your account</h2>
        <p className="mt-0.5 text-sm text-muted">Start turning spreadsheets into insights.</p>
      </div>
      <SignupForm />
    </div>
  );
}
