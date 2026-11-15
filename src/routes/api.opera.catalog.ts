import { createFileRoute } from "@tanstack/react-router";
import { searchOPERACatalogCollections } from "@/lib/nasa-cmr";

export const Route = createFileRoute("/api/opera/catalog")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const result = await searchOPERACatalogCollections();
          return Response.json({
            ...result,
            fetchedAt: new Date().toISOString(),
            source: "NASA CMR",
            dataKind: "catalog-metadata",
          }, {
            headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" },
          });
        } catch (error) {
          console.error("NASA CMR OPERA catalog query failed.", error);
          return Response.json({
            error: error instanceof Error ? error.message : "NASA CMR could not be queried for OPERA metadata.",
          }, { status: 502, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
