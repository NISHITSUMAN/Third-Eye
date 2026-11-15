import { createFileRoute } from "@tanstack/react-router";
import { ExploreScreen } from "@/components/te/ExploreScreen";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Earth Explorer — Third Eye" },
      {
        name: "description",
        content: "Explore live NASA CMR catalogue coverage and attributed public context in 3D or 2D.",
      },
    ],
  }),
  component: ExploreScreen,
});
