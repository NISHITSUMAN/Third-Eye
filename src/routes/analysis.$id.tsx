import { createFileRoute } from "@tanstack/react-router";
import { AnalysisDetail } from "@/components/te/ScientificViews";
export const Route = createFileRoute("/analysis/$id")({ head: ({params}) => ({meta:[{title:`${params.id} — Third Eye`},{name:"description",content:"NASA CMR catalog discovery records, provenance, and limitations."},{property:"og:title",content:`${params.id} — Third Eye`},{property:"og:description",content:"NASA CMR catalog discovery records, provenance, and limitations."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary_large_image"}]}), component: Page });
function Page(){const params=Route.useParams();return <AnalysisDetail id={params.id}/>;}
