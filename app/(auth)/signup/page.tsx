import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account · Sheetform" };

export default function SignupPage() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900">Create account</h2>
      <SignupForm />
    </div>
  );
}