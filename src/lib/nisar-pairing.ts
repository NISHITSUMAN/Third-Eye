import type { NISARGranule } from "./nasa-cmr";

export type NISARFrequency = "frequencyA" | "frequencyB";
export type NISARDiagonalTerm = "HHHH" | "HVHV" | "VVVV" | "VHVH" | "RHRH" | "RVRV";

type Identity = {
  instrument: string; processing: string; relativeOrbit: number; direction: string; frame: number;
  primaryBandwidth: number; secondaryBandwidth: number; primaryMode: string; secondaryMode: string;
  source: string; start: number; end: number; crid: string; orbitAccuracy: string; coverage: string;
};
export type NISARPairAssessment = { compatible: boolean; reasons: string[]; temporalGapDays: number };

const PRODUCT = /^NISAR_([LS])([0-3])_([A-Z]{2})_GCOV_(\d{3})_(\d{3})_([AD])_(\d{3})_(\d{4})_([A-Z]{4})_([AM])_(\d{8}T\d{6})_(\d{8}T\d{6})_(P\d{5})_([PMNF])_([FP])_[A-Z]_(\d{3})$/;
const TERMS: Record<string, NISARDiagonalTerm[]> = {
  SH: ["HHHH"], SV: ["VVVV"], DH: ["HHHH", "HVHV"], DV: ["VVVV", "VHVH"],
  QP: ["HHHH", "HVHV", "VVVV", "VHVH"], CR: ["RHRH", "RVRV"],
};

function parseIdentity(value: string): Identity | null {
  const match = PRODUCT.exec(value.replace(/\.h5$/i, ""));
  if (!match) return null;
  const toTimestamp = (v: string) => Date.parse(v.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z"));
  const start = toTimestamp(match[11]!);
  const end = toTimestamp(match[12]!);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return {
    instrument: match[1]!, processing: match[3]!, relativeOrbit: Number(match[5]), direction: match[6]!,
    frame: Number(match[7]), primaryBandwidth: Number(match[8]!.slice(0, 2)),
    secondaryBandwidth: Number(match[8]!.slice(2)), primaryMode: match[9]!.slice(0, 2),
    secondaryMode: match[9]!.slice(2), source: match[10]!, start, end, crid: match[13]!,
    orbitAccuracy: match[14]!, coverage: match[15]!,
  };
}

export function assessNISARPair(before: NISARGranule, after: NISARGranule, frequency: NISARFrequency, polarizationTerm: NISARDiagonalTerm): NISARPairAssessment {
  const a = parseIdentity(before.granuleId);
  const b = parseIdentity(after.granuleId);
  if (!a || !b) return { compatible: false, reasons: ["One or both product identifiers do not match the documented GCOV naming format."], temporalGapDays: 0 };
  const reasons: string[] = [];
  const checks: Array<[boolean, string]> = [
    [a.instrument === b.instrument, "Instrument differs"], [a.processing === b.processing, "Processing type differs"],
    [a.relativeOrbit === b.relativeOrbit, "Relative orbit track differs"], [a.direction === b.direction, "Orbit direction differs"],
    [a.frame === b.frame, "Frame differs"], [a.primaryBandwidth === b.primaryBandwidth, "Primary bandwidth differs"],
    [a.secondaryBandwidth === b.secondaryBandwidth, "Secondary bandwidth differs"], [a.primaryMode === b.primaryMode, "Primary polarization mode differs"],
    [a.secondaryMode === b.secondaryMode, "Secondary polarization mode differs"], [a.source === b.source, "Acquisition source mode differs"],
    [a.crid === b.crid, "Processing release differs"], [a.orbitAccuracy === b.orbitAccuracy, "Orbit accuracy class differs"],
  ];
  for (const [valid, reason] of checks) if (!valid) reasons.push(reason);
  const mode = frequency === "frequencyA" ? a.primaryMode : a.secondaryMode;
  const bandwidth = frequency === "frequencyA" ? a.primaryBandwidth : a.secondaryBandwidth;
  if (bandwidth === 0) reasons.push("Selected frequency band is absent");
  if (!(TERMS[mode] ?? []).includes(polarizationTerm)) reasons.push(polarizationTerm + " is not available for " + frequency + " mode " + mode);
  const midA = a.start + (a.end - a.start) / 2;
  const midB = b.start + (b.end - b.start) / 2;
  const temporalGapDays = Math.abs(midB - midA) / 86_400_000;
  if (temporalGapDays < 1) reasons.push("Acquisitions are less than one day apart");
  if (temporalGapDays > 365) reasons.push("Acquisitions are more than 365 days apart");
  if (a.coverage !== "F" || b.coverage !== "F") reasons.push("One or both products have partial frame coverage");
  return { compatible: reasons.length === 0, reasons: reasons.length ? reasons : ["Orbit, frame, mode, processing release and temporal checks passed."], temporalGapDays };
}

export function discoverNISARPairs(records: readonly NISARGranule[], frequency: NISARFrequency, polarizationTerm: NISARDiagonalTerm, limit = 8) {
  const scenes = records.filter(record => record.productCode === "GCOV");
  const pairs: Array<{ before: NISARGranule; after: NISARGranule; assessment: NISARPairAssessment }> = [];
  for (let left = 0; left < scenes.length; left += 1) {
    for (let right = left + 1; right < scenes.length; right += 1) {
      const first = scenes[left]!;
      const second = scenes[right]!;
      if (!first.startDate || !second.startDate) continue;
      const ordered = Date.parse(first.startDate) <= Date.parse(second.startDate) ? [first, second] as const : [second, first] as const;
      const assessment = assessNISARPair(ordered[0], ordered[1], frequency, polarizationTerm);
      if (assessment.compatible) pairs.push({ before: ordered[0], after: ordered[1], assessment });
    }
  }
  return pairs.sort((a, b) => a.assessment.temporalGapDays - b.assessment.temporalGapDays).slice(0, limit);
}
