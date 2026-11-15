export function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = value.includes("T")
    ? {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      }
    : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en", options).format(date);
}
