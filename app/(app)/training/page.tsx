import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTrainingLessons } from "@/lib/actions/training";
import { TrainingList } from "@/components/training-list";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const lessons = await getTrainingLessons();

  return <TrainingList lessons={lessons} />;
}
