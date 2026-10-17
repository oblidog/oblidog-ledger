import { expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { categoryQueryKeys } from "../Categories/categoryQueryKeys"
import {
  invalidateObligationAction,
  obligationQueryKeys,
} from "./obligationQueries"

test("lifecycle refresh invalidates every filtered list and only the affected detail/history in this ledger", async () => {
  const client = new QueryClient()
  const affected = [
    obligationQueryKeys.filteredList(
      "home",
      true,
      "2026",
      "10",
      "ELEC",
      "unpaid",
    ),
    obligationQueryKeys.filteredList("home", false, "", "", "", ""),
    obligationQueryKeys.detail("home", "one"),
    obligationQueryKeys.actions("home", "one"),
  ]
  const untouched = [
    obligationQueryKeys.filteredList("other", false, "", "", "", ""),
    obligationQueryKeys.detail("home", "two"),
    obligationQueryKeys.actions("home", "two"),
  ]
  for (const key of [...affected, ...untouched]) client.setQueryData(key, {})
  await invalidateObligationAction(client, "home", "one")
  for (const key of affected)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  for (const key of untouched)
    expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  client.clear()
})

test("category invalidation covers active and archived lists without invalidating other ledgers or groups", async () => {
  const client = new QueryClient()
  const keys = [
    categoryQueryKeys.list("home", false),
    categoryQueryKeys.list("home", true),
    categoryQueryKeys.list("other", false),
    categoryQueryKeys.groupList("home", false),
  ]
  for (const key of keys) client.setQueryData(key, {})
  await client.invalidateQueries({
    queryKey: categoryQueryKeys.categories("home"),
  })
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
    false,
  ])
  client.clear()
})
