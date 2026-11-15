import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/te/PageShell";
import { DiscoverBody } from "@/components/te/pages";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Discover — Third Eye" },
      { name: "description", content: "Real NASA CMR NISAR acquisition records and browse quicklooks; derived science products are not deployed." },
      { property: "og:title", content: "Discover — Third Eye" },
      { property: "og:description", content: "Curated Earth stories and notable changes detected across the planet." },
    ],
  }),
  component: () => (
    <PageShell eyebrow="DISCOVER" title="NISAR catalog discovery" intro="Browse live NISAR product coverage and source quicklooks. No derived change detections are available in this deployment.">
      <DiscoverBody />
    </PageShell>
  ),
});
