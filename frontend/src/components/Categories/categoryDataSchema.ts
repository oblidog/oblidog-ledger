export type JsonSchemaProperty = Record<string, unknown>

function isRecord(value: unknown): value is JsonSchemaProperty {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function unwrapNullablePropertySchema(value: JsonSchemaProperty) {
  if (!Array.isArray(value.anyOf) || value.anyOf.length !== 2) {
    return { value, nullable: false }
  }

  const nullOption = value.anyOf.find(
    (option) => isRecord(option) && option.type === "null",
  )
  const typedOption = value.anyOf.find(
    (option) => isRecord(option) && option.type !== "null",
  )

  return nullOption && typedOption
    ? { value: typedOption, nullable: true }
    : { value, nullable: false }
}
