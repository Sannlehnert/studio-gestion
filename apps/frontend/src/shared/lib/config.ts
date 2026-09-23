export function readConfig(env: Record<string, unknown>) {
  const raw = env.VITE_API_BASE_URL ?? "http://localhost:3000";
  if (typeof raw !== "string") throw new Error("Configuración de API inválida");
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "La API debe ser un origen HTTP(S) sin credenciales ni ruta",
    );
  if (env.PROD && url.protocol !== "https:")
    throw new Error("Producción requiere HTTPS");
  const timeZone =
    env.VITE_BUSINESS_TIMEZONE ?? "America/Argentina/Buenos_Aires";
  if (typeof timeZone !== "string") throw new Error("Zona horaria inválida");
  new Intl.DateTimeFormat("es-AR", { timeZone }).format();
  return { apiBaseUrl: url.origin, timeZone };
}
