import { UploadFlow } from "@/components/upload-flow";

export const metadata = { title: "New dataset · SiroQ" };

export default function NewDatasetPage() {
  return (
    <div className="mx-auto max-w-4xl animate-slide-up">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Upload a dataset
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          Drop a CSV or Excel file, confirm the columns, and we’ll handle the rest.
        </p>
      </div>
      <UploadFlow />
    </div>
  );
}
