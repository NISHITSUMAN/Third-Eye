import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/analyze")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Analyze — Third Eye" },
      { name: "description", content: "Discover real NISAR acquisitions for a selected area, product family and date range. Full raster processing is not executed by this frontend." },
      { property: "og:title", content: "Analyze — Third Eye" },
      { property: "og:description", content: "Open area-based catalog discovery tools in Explore. Raster analysis is not available in this deployment." },
    ],
  }),
  component: AnalyzeRedirect,
});

function AnalyzeRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    useApp.getState().setAnalysisOpen(true);
    void navigate({ to: "/dashboard", replace: true });
  }, [navigate]);
  return <div className="p-6 text-sm text-muted-foreground">Opening analysis tools in the Earth dashboard…</div>;
}
