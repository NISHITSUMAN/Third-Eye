import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/te/PageShell";
import { EventsBody } from "@/components/te/pages";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Events — Third Eye" },
      { name: "description", content: "Explore NASA NISAR catalog coverage and separately attributed public event reports." },
      { property: "og:title", content: "Events — Third Eye" },
      { property: "og:description", content: "Browse source-reported public events without treating them as NISAR detections." },
    ],
  }),
  component: () => (
    <PageShell eyebrow="EVENTS" title="Source-reported event catalog" intro="Inspect public event records independently of NISAR acquisition metadata. These reports are not satellite-derived detections.">
      <EventsBody />
    </PageShell>
  ),
});
