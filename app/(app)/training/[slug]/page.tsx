import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTrainingLesson } from "@/lib/actions/training";
import { LessonView } from "@/components/lesson-view";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const lesson = await getTrainingLesson(slug);
  if (!lesson) notFound();

  return <LessonView lesson={lesson} />;
}
