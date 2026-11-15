import { createFileRoute } from "@tanstack/react-router";
import { ExploreScreen } from "@/components/te/ExploreScreen";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Earth Intelligence — Third Eye" },
      {
        name: "description",
        content:
          "Explore attributed NASA NISAR catalogue coverage, public event context, weather, and evidence-based Earth analysis.",
      },
    ],
  }),
  component: ExploreScreen,
});
