import type { components } from "../api/schema";
type HistoryItem = components["schemas"]["AttendanceHistoryItemDto"];
type Context = components["schemas"]["StudentHomeSummaryDto"]["context"];
export const attendanceLabels = {
  PRESENT: "Presente",
  ABSENT: "Ausente",
} satisfies Record<HistoryItem["effectiveStatus"], string>;
export const participationLabels = {
  REGULAR: "Clase habitual",
  RECOVERY: "Recuperación",
} satisfies Record<HistoryItem["participationKind"], string>;
export const subscriptionContextLabels = {
  CURRENT: "Período actual",
  UPCOMING: "Próximo período",
  NONE: "Sin período actual o próximo",
} satisfies Record<Context, string>;
