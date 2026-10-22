import { describe, expect, test } from "bun:test"
import { i18n, resources } from "./index"

function flatten(
  value: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof child === "string"
        ? [[path, child]]
        : Object.entries(flatten(child as Record<string, unknown>, path))
    }),
  )
}

// Each language must provide its own plural categories, not English's suffixes.
export function normalizeResources(
  value: Record<string, unknown>,
  language: string,
) {
  const categories = new Intl.PluralRules(language).resolvedOptions()
    .pluralCategories
  const flat = flatten(value)
  const normalized: Record<string, string> = {}
  const plurals = new Map<string, Set<string>>()
  for (const [key, text] of Object.entries(flat)) {
    const match = key.match(/^(.*)_(zero|one|two|few|many|other)$/)
    const base = match?.[1] ?? key
    const params = [...text.matchAll(/{{\s*([\w.]+)(?:\s*,[^}]*)?\s*}}/g)]
      .map((m) => m[1])
      .sort()
      .join(",")
    if (base in normalized && normalized[base] !== params) {
      throw new Error(`Interpolation mismatch: ${key}`)
    }
    normalized[base] = params
    if (match) {
      const seen = plurals.get(base) ?? new Set<string>()
      seen.add(match[2])
      plurals.set(base, seen)
    }
  }
  for (const [base, seen] of plurals) {
    for (const category of categories) {
      if (!seen.has(category))
        throw new Error(`Missing ${language} plural: ${base}_${category}`)
    }
  }
  return normalized
}

describe("translation resources", () => {
  test("all namespaces have matching keys and interpolation parameters", () => {
    for (const [language, namespaces] of Object.entries(resources)) {
      expect(normalizeResources(namespaces, language)).toEqual(
        normalizeResources(resources.en, "en"),
      )
    }
  })
  test("allows Polish plural categories and detects missing forms/parameters", () => {
    const en = { items_one: "{{count}} item", items_other: "{{count}} items" }
    const pl = {
      items_one: "{{count}} element",
      items_few: "{{count}} elementy",
      items_many: "{{count}} elementów",
      items_other: "{{count}} elementu",
    }
    expect(normalizeResources(pl, "pl")).toEqual(normalizeResources(en, "en"))
    expect(() =>
      normalizeResources({ items_one: "{{count}} element" }, "pl"),
    ).toThrow()
    expect(() =>
      normalizeResources({ ...pl, items_few: "elementy" }, "pl"),
    ).toThrow()
  })
  test("switches real navigation resources with English fallback", async () => {
    await i18n.changeLanguage("pl")
    expect(i18n.t("navigation.obligations")).toBe("Zobowiązania")
    await i18n.changeLanguage("de")
    expect(i18n.t("navigation.obligations")).toBe("Zahlungsverpflichtungen")
    await i18n.changeLanguage("fr")
    expect(i18n.t("navigation.obligations")).toBe("Obligations")
    await i18n.changeLanguage("en")
  })
})

test("every resource resolves in its own namespace and language without fallback", () => {
  for (const [language, namespaces] of Object.entries(resources)) {
    for (const [namespace, dictionary] of Object.entries(namespaces)) {
      for (const [key, text] of Object.entries(flatten(dictionary))) {
        expect(i18n.getResource(language, namespace, key)).toBe(text)
      }
    }
  }
})
