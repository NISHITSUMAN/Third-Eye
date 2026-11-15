import { createFileRoute } from '@tanstack/react-router';
import MissionDashboard from '@/features/intro/MissionDashboard';
export const Route = createFileRoute('/team-drishti')({
  head: () => ({ meta: [
    { title: "Team Cypher | THIRD EYE" },
    { name: 'description', content: "Meet the five members behind the independent THIRD EYE Space Apps project." },
    { property: 'og:title', content: "Team Cypher | THIRD EYE" },
    { property: 'og:description', content: "Meet the five members behind the independent THIRD EYE Space Apps project." },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: () => <MissionDashboard view="team" />,
});
