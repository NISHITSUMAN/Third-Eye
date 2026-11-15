import { createFileRoute } from "@tanstack/react-router";
import { PhenomenonDetail } from "@/components/te/ScientificViews";
export const Route = createFileRoute("/intelligence_/$phenomenon")({ head: ({params}) => ({meta:[{title:`${params.phenomenon} processing status — Third Eye`},{name:"description",content:"Scientific processing status and current source limitations."},{property:"og:title",content:`${params.phenomenon} processing status — Third Eye`},{property:"og:description",content:"Scientific processing status and current source limitations."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary_large_image"}]}), component: Page });
function Page(){const params=Route.useParams();return <PhenomenonDetail phenomenon={params.phenomenon}/>;}
