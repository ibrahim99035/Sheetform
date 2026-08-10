import { UploadFlow } from "@/components/upload-flow";

export const metadata = { title: "New dataset · Sheetform" };

export default function NewDatasetPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">
        Upload a dataset
      </h1>
      <UploadFlow />
    </div>
  );
}