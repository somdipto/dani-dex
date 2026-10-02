/** Values admitted from the JSON responses used by the command-line workflows. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
export function isJsonObject(value: unknown): value is JsonObject {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(isJsonValue)
  );
}
export function parseJsonValue(text: string): JsonValue {
  const value = JSON.parse(text);
  if (!isJsonValue(value)) throw new Error("Expected JSON value");
  return value;
}
