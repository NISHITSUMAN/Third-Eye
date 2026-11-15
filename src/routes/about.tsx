import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/te/PageShell";
import { AboutBody } from "@/components/te/pages";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "About — Third Eye" },
      { name: "description", content: "Third Eye is an Earth-observation explorer for NASA CMR catalog metadata and separately attributed public-event sources." },
      { property: "og:title", content: "About — Third Eye" },
      { property: "og:description", content: "Third Eye separates NASA catalog records, public event reports, geographic context, and unimplemented processing capabilities." },
    ],
  }),
  component: () => (
    <PageShell eyebrow="ABOUT" title="About Third Eye" intro="See. Detect. Understand.">
      <AboutBody />
    </PageShell>
  ),
});
