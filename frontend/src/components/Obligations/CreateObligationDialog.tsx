import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CategoriesService, ObligationsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"
import { categoryQueryKeys } from "../Categories/categoryQueryKeys"
import { ObligationValueFields } from "./ObligationValueFields"
import {
  dueDateRange,
  monthInputValue,
  parseMonthInput,
} from "./obligationLogic"
import { touchDialogClasses } from "./obligationPresentation"
import { obligationQueryKeys } from "./obligationQueries"

export function CreateObligationDialog({
  ledgerId,
  defaultPeriod,
  onSuccess,
  onError,
}: {
  ledgerId: string
  defaultPeriod: { year: number; month: number }
  onSuccess: (message: string) => void
  onError: (message: string) => void
}) {
  useTranslation()

  const [open, setOpen] = useState(false)
  const [categoryCode, setCategoryCode] = useState("")
  const [year, setYear] = useState(String(defaultPeriod.year))
  const [month, setMonth] = useState(String(defaultPeriod.month))
  const [dataReady, setDataReady] = useState(false)
  const [currentAmount, setCurrentAmount] = useState("")
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  useEffect(() => {
    if (!open) {
      return
    }
    setYear(String(defaultPeriod.year))
    setMonth(String(defaultPeriod.month))
  }, [defaultPeriod.month, defaultPeriod.year, open])
  const submitLock = useRef(false)
  const queryClient = useQueryClient()
  const categories = useQuery({
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
    queryKey: categoryQueryKeys.categories(ledgerId),
  })
  const manualCategories = categories.data?.data.filter(
    (category) => category.data_source_policy !== "automatic",
  )
  const selectedCategory = categories.data?.data.find(
    (category) => category.code === categoryCode,
  )
  const periodYear = Number(year)
  const periodMonth = Number(month)
  const dueDateLimits = dueDateRange(
    Number.isInteger(periodYear) && periodYear > 0
      ? periodYear
      : defaultPeriod.year,
    Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12
      ? periodMonth
      : defaultPeriod.month,
  )
  const dueDateOutOfRange =
    dueDate !== "" &&
    (dueDate < dueDateLimits.min || dueDate > dueDateLimits.max)
  const issueDateAfterDueDate =
    issueDate !== "" && dueDate !== "" && issueDate > dueDate
  const mutation = useMutation({
    mutationFn: () =>
      ObligationsService.createObligation({
        ledgerId,
        requestBody: {
          category_code: categoryCode,
          period: { year: Number(year), month: Number(month) },
          data_ready: dataReady,
          current_amount: currentAmount || undefined,
          issue_date: issueDate || undefined,
          due_date: dueDate || undefined,
          notes: notes || undefined,
        },
      }),
    onError: handleError.bind(onError),
    onSuccess: () => {
      onSuccess(i18n.t("app:obligations.obligation_created"))
      setOpen(false)
      void queryClient.invalidateQueries({
        queryKey: obligationQueryKeys.list(ledgerId),
      })
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {i18n.t("app:obligations.new_obligation")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${touchDialogClasses}`}
      >
        <DialogHeader className="pr-10">
          <DialogTitle>
            {i18n.t("app:obligations.create_manual_obligation")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t("app:obligations.choose_a_category_and_billing_period")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="obligation-category">
              {i18n.t("app:obligations.category")}
            </Label>
            <select
              id="obligation-category"
              className="border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
            >
              <option value="" className="bg-background text-foreground">
                {i18n.t("app:obligations.choose_a_category")}
              </option>
              {manualCategories?.map((category) => (
                <option
                  key={category.id}
                  value={category.code}
                  className="bg-background text-foreground"
                >
                  {category.name} ({category.code} · {category.currency})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obligation-period">
              {i18n.t("app:obligations.billing_period")}
            </Label>
            <Input
              id="obligation-period"
              type="month"
              value={monthInputValue(year, month)}
              onChange={(event) => {
                const selectedPeriod = parseMonthInput(event.target.value)
                setYear(selectedPeriod?.year ?? "")
                setMonth(selectedPeriod?.month ?? "")
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="obligation-data-ready"
              checked={dataReady}
              onCheckedChange={(checked) => setDataReady(checked === true)}
            />
            <Label htmlFor="obligation-data-ready">
              {i18n.t("app:obligations.is_the_data_ready")}
            </Label>
          </div>
          <ObligationValueFields
            idPrefix="obligation"
            currency={selectedCategory?.currency}
            dataReady={dataReady}
            currentAmount={currentAmount}
            setCurrentAmount={setCurrentAmount}
            issueDate={issueDate}
            setIssueDate={setIssueDate}
            dueDate={dueDate}
            setDueDate={setDueDate}
            dueDateLimits={dueDateLimits}
            notes={notes}
            setNotes={setNotes}
          />
          <LoadingButton
            className="min-h-11 w-full"
            loading={mutation.isPending}
            disabled={
              !categoryCode ||
              !year ||
              !month ||
              dueDateOutOfRange ||
              issueDateAfterDueDate ||
              (dataReady && (!currentAmount || !dueDate))
            }
            onClick={() => {
              if (submitLock.current) return
              submitLock.current = true
              void mutation
                .mutateAsync()
                .catch(() => {})
                .finally(() => {
                  submitLock.current = false
                })
            }}
          >
            {i18n.t("app:obligations.create_obligation")}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
