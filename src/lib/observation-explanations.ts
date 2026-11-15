import type { NISARMaturity, NISARProductCode } from "./sar-registry";

export interface NISARObservationExplanation {
  label: string;
  explanation: string;
  applications: string[];
}

const NISAR_PRODUCT_EXPLANATIONS: Partial<Record<
  NISARProductCode,
  Omit<NISARObservationExplanation, "explanation"> & { explanation: string }
>> = {
  GSLC: {
    label: "Map-aligned radar data",
    explanation: "NISAR used radar to collect detailed information about the surface here. NASA has positioned this dataset on a map, but it is not a normal photograph. This panel shows where the data is available; Third Eye has not opened or analyzed the radar measurements.",
    applications: [
      "Studying how land and terrain reflect radar signals",
      "Comparing observations to research changes at the surface",
    ],
  },
  GCOV: {
    label: "Radar reflections from the land",
    explanation: "NISAR measured how radar signals bounced back from land in this area. NASA organized these measurements by location so researchers can study land and vegetation. This record only shows where data is available; it does not confirm a flood, crop condition, or other change, and Third Eye has not analyzed the measurements.",
    applications: [
      "Studying how radar backscatter and polarization vary across land surfaces",
      "Using geocoded radar-covariance inputs in environmental research",
    ],
  },
  RSLC: {
    label: "Detailed radar signal data",
    explanation: "NISAR collected detailed radar signals over this area. This specialist dataset stays in the satellite's radar coordinates rather than appearing as a regular map image. The map shows its coverage only; Third Eye has not processed the signal data.",
    applications: [
      "Studying radar signals in detail",
      "Preparing data for advanced comparisons between observations",
    ],
  },
  GUNW: {
    label: "Ground-movement research data",
    explanation: "NASA combines radar observations from two times into data that researchers can use to study whether the land has moved. This catalog entry shows where the product is available; it does not report how much movement occurred, and Third Eye has not measured it.",
    applications: ["Researching changes in the ground between observations"],
  },
  GOFF: {
    label: "Surface-shift data",
    explanation: "This product records shifts between paired NISAR radar images. Researchers often use it to study moving ice, but this catalog entry does not report glacier speed, and Third Eye has not analyzed the underlying data.",
    applications: ["Studying glacier and ice movement"],
  },
  ROFF: {
    label: "Radar-coordinate shift data",
    explanation: "This product records surface shifts between paired radar observations, but keeps them in the satellite's radar coordinates rather than aligning them to a map. It can support ice-motion research; this catalog entry is not a movement measurement by Third Eye.",
    applications: ["Studying glacier and ice movement"],
  },
  SME2: {
    label: "Soil-moisture estimate data",
    explanation: "Repeated NISAR radar observations are used to estimate moisture in the upper soil. Researchers can use these estimates to study crops and water availability. This catalog entry shows where the product is available; Third Eye has not displayed or checked its moisture values.",
    applications: ["Researching soil moisture and agricultural water availability"],
  },
};

export function getNISARObservationExplanation(
  productCode: NISARProductCode | "NISAR",
  maturity: NISARMaturity,
): NISARObservationExplanation {
  const product = productCode === "NISAR" ? undefined : NISAR_PRODUCT_EXPLANATIONS[productCode];
  if (!product) {
    return {
      label: "NISAR radar data",
      explanation: `NASA CMR lists this as a NISAR ${productCode} product. The record shows data availability and coverage, not an environmental detection.`,
      applications: [],
    };
  }
  return {
    ...product,
    explanation: `${product.explanation}${maturity === "provisional" ? " NASA marks this collection provisional." : ""}`,
  };
}
