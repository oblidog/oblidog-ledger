import type { ComponentHistoryResponse } from "./componentHistoryApi"

type Total = ComponentHistoryResponse["totals"][number]

// Keep decimal money exact, including amounts above Number.MAX_SAFE_INTEGER.
export function costChange(
  previous: Total | undefined,
  current: Total | undefined,
) {
  if (
    !previous ||
    !current ||
    previous.obligation_amount === null ||
    current.obligation_amount === null ||
    !previous.currency ||
    previous.currency !== current.currency
  )
    return null
  const scale = Math.max(
    2,
    previous.obligation_amount.split(".")[1]?.length ?? 0,
    current.obligation_amount.split(".")[1]?.length ?? 0,
  )
  const units = (value: string) => {
    const negative = value.startsWith("-")
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".")
    return BigInt(whole + fraction.padEnd(scale, "0")) * (negative ? -1n : 1n)
  }
  const before = units(previous.obligation_amount)
  const difference = units(current.obligation_amount) - before
  const absolute = (difference < 0n ? -difference : difference)
    .toString()
    .padStart(scale + 1, "0")
  const amount = `${difference < 0n ? "-" : ""}${absolute.slice(0, -scale)}.${absolute.slice(-scale)}`
  // Round percentage to hundredths; a zero baseline has no percentage.
  const denominator = before < 0n ? -before : before
  const numerator = (difference < 0n ? -difference : difference) * 10000n
  const percentage =
    denominator === 0n
      ? null
      : (Number((numerator + denominator / 2n) / denominator) / 100) *
        (difference < 0n ? -1 : 1)
  return {
    amount,
    percentage:
      percentage !== null && Number.isFinite(percentage) ? percentage : null,
    positive: difference > 0n,
  }
}
