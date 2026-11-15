import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/te/PageShell";
import { TimelineBody } from "@/components/te/pages";

export const Route = createFileRoute("/timeline")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Timeline — Third Eye" },
      { name: "description", content: "A time-filtered chronology of real NISAR acquisition records and separately sourced public events." },
      { property: "og:title", content: "Timeline — Third Eye" },
      { property: "og:description", content: "A chronological view of catalog acquisitions and public events in the selected time window." },
    ],
  }),
  component: () => (
    <PageShell eyebrow="TIMELINE" title="Historical chronology" intro="Review acquisitions and events from the selected historical time window; future dates are excluded.">
      <TimelineBody />
    </PageShell>
  ),
});
