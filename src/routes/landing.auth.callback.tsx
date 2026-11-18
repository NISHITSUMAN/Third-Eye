import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/landing/auth/callback")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
  component: () => null,
});
