import { describe, expect, test } from "bun:test"
import {
  categoryConfigurationSchema,
  categorySchema,
  groupSchema,
} from "./categoryForms"
import { recurrencePreset } from "./categoryPresentation"

const configuration = {
  name: " Electricity ",
  data_source_policy: "manual",
  currency: "PLN",
}

describe("category forms", () => {
  test("create requires a group and a four-letter code; edit shares configuration validation", () => {
    expect(categoryConfigurationSchema.parse(configuration).name).toBe(
      "Electricity",
    )
    expect(categorySchema.safeParse(configuration).success).toBe(false)
    const create = {
      ...configuration,
      category_group_id: "group",
      code: " ELEC ",
    }
    expect(categorySchema.parse(create).code).toBe("ELEC")
    for (const code of ["elec", "ABC", "ABCDE", "AB12"])
      expect(categorySchema.safeParse({ ...create, code }).success).toBe(false)
    for (const invalid of [
      { name: " " },
      { currency: "XYZ" },
      { recurrence_interval: 0 },
      { recurrence_interval: 1.5 },
    ]) {
      expect(categorySchema.safeParse({ ...create, ...invalid }).success).toBe(
        false,
      )
      expect(
        categoryConfigurationSchema.safeParse({ ...configuration, ...invalid })
          .success,
      ).toBe(false)
    }
    expect(groupSchema.safeParse({ name: " " }).success).toBe(false)
  })

  test("schedule presets distinguish monthly, two-month, annual and custom schedules", () => {
    expect(recurrencePreset(1, "month")).toBe("monthly")
    expect(recurrencePreset(2, "month")).toBe("every-two-months")
    expect(recurrencePreset(1, "year")).toBe("yearly")
    expect(recurrencePreset(3, "month")).toBe("custom")
    expect(recurrencePreset(undefined, undefined)).toBe("custom")
  })
})
