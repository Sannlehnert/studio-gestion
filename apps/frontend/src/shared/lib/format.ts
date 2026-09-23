export type CivilDate = string & { readonly __civil: unique symbol };
export function civilDate(value: string): CivilDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Fecha civil inválida");
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error("Fecha civil inválida");
  return value as CivilDate;
}
export function formatCivil(value: string): string {
  const [year, month, day] = civilDate(value).split("-");
  return `${day}/${month}/${year}`;
}
export function formatInstant(value: string, timeZone: string): string {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error("El instante requiere zona");
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(value));
}
// Decimal string stays exact, including values above Number.MAX_SAFE_INTEGER.
export function formatMoney(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Importe decimal inválido");
  const integer = BigInt(match[2]!);
  return `${match[1]}$\u00a0${new Intl.NumberFormat("es-AR").format(integer)},${(match[3] ?? "").padEnd(2, "0")}`;
}
export function formatQuantity(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Cantidad inválida");
  return new Intl.NumberFormat("es-AR").format(value);
}
