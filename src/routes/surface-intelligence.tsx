import { createFileRoute } from '@tanstack/react-router';
import MissionDashboard from '@/features/intro/MissionDashboard';
export const Route = createFileRoute('/surface-intelligence')({
  head: () => ({ meta: [
    { title: "Surface Intelligence | THIRD EYE" },
    { name: 'description', content: 'Explore illustrative interferometric phase patterns, not measured displacement.' },
    { property: 'og:title', content: "Surface Intelligence | THIRD EYE" },
    { property: 'og:description', content: 'Explore illustrative interferometric phase patterns, not measured displacement.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: () => <MissionDashboard view="surface" />,
});
