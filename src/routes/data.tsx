import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/te/PageShell";
import { DataBody } from "@/components/te/pages";

export const Route = createFileRoute("/data")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Data Explorer — Third Eye" },
      { name: "description", content: "Search live NASA NISAR, OPERA, public event, and Planetary Computer observation catalogs." },
      { property: "og:title", content: "Data Explorer — Third Eye" },
      { property: "og:description", content: "Search live NASA NISAR, OPERA, public event, and Planetary Computer observation catalogs." },
    ],
  }),
  component: () => (
    <PageShell eyebrow="DATA" title="Data explorer" intro="Search current NASA and Microsoft catalog records by area and date. Catalog metadata is not processed science.">
      <DataBody />
    </PageShell>
  ),
});
