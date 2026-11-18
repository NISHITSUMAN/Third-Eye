import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import LearnApp from "@/features/learn/LearnApp";
import "@/features/learn/learn-base.css";

export const Route = createFileRoute("/learn")({
  validateSearch: (search: Record<string, unknown>) => ({
    section: typeof search.section === "string" ? search.section : undefined,
    level: parsePositiveInteger(search.level),
    chapter: parsePositiveInteger(search.chapter),
    lesson: parsePositiveInteger(search.lesson),
  }),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Learn — Third Eye" },
      { name: "description", content: "Understand radar, InSAR and how Third Eye interprets Earth change." },
      { property: "og:title", content: "Learn — Third Eye" },
      { property: "og:description", content: "Understand radar, InSAR and how Third Eye interprets Earth change." },
    ],
  }),
  component: LearnRoute,
});

function parsePositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function LearnRoute() {
  return (
    <ClientOnly fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" role="status">Loading the learning workspace…</div>}>
      <div className="learning-experience">
        <LearnApp key="guest" userId="guest" userEmail={null} signOut={async () => undefined} />
      </div>
    </ClientOnly>
  );
}
