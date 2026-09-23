import type { components } from "./schema";
export type ApiError = components["schemas"]["ApiErrorDto"];
export type FailureKind =
  "http" | "network" | "timeout" | "cancelled" | "invalid-response";
export class ApiFailure extends Error {
  constructor(
    public kind: FailureKind,
    public status = 0,
    public code: string = "",
    public uncertain = false,
    public retryAfter: string | null = null,
  ) {
    super("La solicitud no pudo completarse");
  }
}
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiFailure))
    return "No pudimos completar la operación. Intentá nuevamente.";
  if (error.uncertain)
    return "No pudimos confirmar el resultado. Revisá el registro antes de volver a enviar.";
  if (error.kind === "network" || error.kind === "timeout")
    return "No pudimos conectarnos. Revisá tu conexión y volvé a intentar.";
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: "No pudimos ingresar con esos datos.",
    STUDENT_ACCESS_INVALID:
      "Este acceso no se puede usar. Pedile uno nuevo a tu profesora.",
    CSRF_REJECTED:
      "No pudimos autorizar esta conexión. Revisá cómo abriste la aplicación.",
    VALIDATION_FAILED: "Revisá los datos ingresados.",
    CLASS_SESSION_FULL: "No quedan lugares en esta clase. Elegí otra opción.",
    PAYMENT_IDEMPOTENCY_CONFLICT:
      "El intento de pago no coincide con el anterior. Revisá el registro.",
    ATTENDANCE_QR_INVALID:
      "No pudimos validar ese QR. Escaneá el que muestra tu profesora.",
    ATTENDANCE_WINDOW_CLOSED:
      "El registro de asistencia para esta clase ya cerró.",
    ALLOWANCE_EXHAUSTED: "No quedan clases disponibles en este contrato.",
  };
  if (messages[error.code]) return messages[error.code]!;
  if (error.status === 401) return "Necesitás volver a ingresar.";
  if (error.status === 403)
    return "No tenés permiso para acceder a esta opción.";
  if (error.status === 404) return "No encontramos este registro.";
  if (error.status === 429)
    return "Hubo demasiados intentos. Esperá un momento antes de reintentar.";
  if (error.status === 409)
    return "La información cambió o la operación no está disponible. Revisá el estado actual.";
  return "No pudimos completar la operación. Intentá nuevamente.";
}
