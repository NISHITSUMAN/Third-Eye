import { createFileRoute } from "@tanstack/react-router";
import CinematicIntro from "@/features/intro/CinematicIntro";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "THIRD EYE — See what the eye cannot | Team Cypher" },
      {
        name: "description",
        content: "A cinematic introduction to Third Eye and its Earth-observation mission.",
      },
    ],
  }),
  component: CinematicIntro,
});
