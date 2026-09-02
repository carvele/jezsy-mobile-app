export function formatPHDate(dateString: string | Date | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  if (!dateString) return "N/A";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "N/A";
    
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
      ...options
    }).format(d);
  } catch {
    return "N/A";
  }
}
