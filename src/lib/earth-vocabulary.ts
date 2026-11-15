export type Phenomenon =
  | "fire" | "flood" | "forest" | "agriculture" | "soil" | "landslide"
  | "volcano" | "earthquake" | "glacier" | "subsidence" | "coastal" | "urban";

export const PHENOMENA: { id: Phenomenon; label: string; color: string }[] = [
  { id: "fire", label: "Fire", color: "#ff6a2b" },
  { id: "flood", label: "Flood", color: "#2fb8ff" },
  { id: "forest", label: "Forest", color: "#4fbf6a" },
  { id: "agriculture", label: "Agriculture", color: "#a6d65a" },
  { id: "soil", label: "Soil Moisture", color: "#3fc7a8" },
  { id: "landslide", label: "Landslide", color: "#ffa53a" },
  { id: "volcano", label: "Volcano", color: "#ff4d3d" },
  { id: "earthquake", label: "Earthquake", color: "#a98bff" },
  { id: "glacier", label: "Glacier", color: "#cdefff" },
  { id: "subsidence", label: "Subsidence", color: "#e07a5f" },
  { id: "coastal", label: "Coastal Change", color: "#5ad1e0" },
  { id: "urban", label: "Urban Change", color: "#ff8a4a" },
];

export const phenomenonColor = (phenomenon: Phenomenon) =>
  PHENOMENA.find((item) => item.id === phenomenon)?.color ?? "var(--primary)";

export const phenomenonLabel = (phenomenon: Phenomenon) =>
  PHENOMENA.find((item) => item.id === phenomenon)?.label ?? "Surface Change";

export const formatCoord = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}  ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;

export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
