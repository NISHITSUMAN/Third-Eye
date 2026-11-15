import { createFileRoute } from "@tanstack/react-router";
import LandingExperience from "@/features/landing/LandingExperience";

export const Route = createFileRoute("/landing/auth/callback")({
  component: LandingExperience,
});
