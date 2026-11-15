import { createFileRoute } from "@tanstack/react-router";
import LandingExperience from "@/features/landing/LandingExperience";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "Landing — THIRD EYE" },
      { name: "description", content: "Private Landing workspace." },
    ],
  }),
  component: LandingExperience,
});
