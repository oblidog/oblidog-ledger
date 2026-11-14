import { useRouter } from "@tanstack/react-router"
import { useCallback, useSyncExternalStore } from "react"
import {
  type LifecycleFilter,
  type ObligationFilters,
  parseObligationFilters,
  serializeObligationFilters,
} from "./obligationLogic"
import { currentPeriod } from "./obligationPresentation"

export function useObligationFilters(defaultLifecycle: LifecycleFilter) {
  const { history } = useRouter()
  const subscribe = useCallback(
    (notify: () => void) => history.subscribe(() => notify()),
    [history],
  )
  const snapshot = useCallback(() => history.location.search, [history])
  const search = useSyncExternalStore(subscribe, snapshot, () => "")
  const filters = parseObligationFilters(
    search,
    defaultLifecycle,
    currentPeriod(),
  )
  const update = (patch: Partial<ObligationFilters>) => {
    const location = history.location
    const next = serializeObligationFilters(location.search, {
      ...filters,
      ...patch,
    })
    const nextSearch = next ? `?${next}` : ""
    if (nextSearch === location.search) return
    const href = `${location.pathname}${nextSearch}${location.hash}`
    if (patch.periods && patch.periods.join() !== filters.periods.join()) {
      history.push(href, location.state)
    } else {
      history.replace(href, location.state)
    }
  }
  return { filters, search, update }
}
