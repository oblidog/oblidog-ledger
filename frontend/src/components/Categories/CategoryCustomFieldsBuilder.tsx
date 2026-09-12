import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useBlocker } from "@tanstack/react-router"
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { z } from "zod"

import {
  ApiError,
  CategoriesService,
  type CategoryDataSchemaCreate,
  type CategoryDataSchemaPublic,
  type CategoryPublic,
} from "@/client"
import {
  type JsonSchemaProperty,
  unwrapNullablePropertySchema,
} from "@/components/Categories/categoryDataSchema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const fieldTypes = [
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "date-time",
] as const

const customFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, numbers, and underscores"),
  title: z.string().trim().optional(),
  description: z.string().trim().optional(),
  type: z.enum(fieldTypes),
  required: z.boolean(),
  nullable: z.boolean(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enumValues: z.string().optional(),
})

const customFieldsSchema = z
  .object({ fields: z.array(customFieldSchema) })
  .superRefine(({ fields }, context) => {
    const keys = new Set<string>()
    fields.forEach((field, index) => {
      if (keys.has(field.key)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "key"],
          message: "Field names must be unique",
        })
      }
      keys.add(field.key)
      if (
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "maxLength"],
          message: "Maximum length must be at least the minimum",
        })
      }
      if (
        field.minimum !== undefined &&
        field.maximum !== undefined &&
        field.minimum > field.maximum
      ) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "maximum"],
          message: "Maximum must be at least the minimum",
        })
      }
    })
  })

const customFieldDraftSchema = z.object({
  key: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(fieldTypes),
  required: z.boolean(),
  nullable: z.boolean(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enumValues: z.string().optional(),
})

const customFieldsDraftSchema = z.object({
  fields: z.array(customFieldDraftSchema),
})

type CustomFieldsForm = z.infer<typeof customFieldsSchema>
type CustomField = CustomFieldsForm["fields"][number]
function draftKey(ledgerId: string, categoryId: string) {
  return `category-custom-fields-draft:${ledgerId}:${categoryId}`
}

function jsonDraftKey(ledgerId: string, categoryId: string) {
  return `category-data-schema-json-draft:${ledgerId}:${categoryId}`
}

function readDraft(key: string): CustomFieldsForm | null {
  try {
    const draft: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "null",
    )
    const parsed = customFieldsDraftSchema.safeParse(draft)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function readJsonDraft(key: string): string | null {
  try {
    const draft = window.localStorage.getItem(key)
    return draft === null ? null : draft
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function unsupportedSchemaReason(schema: CategoryDataSchemaPublic | null) {
  if (!schema) return null
  if (!isRecord(schema.schema)) return "The schema root is not an object."

  const definition = schema.schema
  const supportedRootKeywords = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
  ])
  const unsupportedRootKeyword = Object.keys(definition).find(
    (key) => !supportedRootKeywords.has(key),
  )
  if (unsupportedRootKeyword) {
    return `It uses the unsupported root keyword “${unsupportedRootKeyword}”.`
  }
  if (definition.type !== "object") {
    return "Its root type is not an object."
  }
  if (definition.additionalProperties !== false) {
    return "Its additional-properties setting is not supported by this builder."
  }
  const properties = definition.properties
  if (!isRecord(properties)) {
    return "Its properties definition is not an object."
  }
  if (
    !Array.isArray(definition.required) ||
    !definition.required.every((value) => typeof value === "string")
  ) {
    return "Its required-fields definition is not supported by this builder."
  }
  if (
    definition.required.some((key) => !Object.keys(properties).includes(key))
  ) {
    return "It requires a field that is not defined in its properties."
  }

  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) return `Field “${key}” is not an object definition.`
    const { value: typedValue, nullable } = unwrapNullablePropertySchema(value)
    if (nullable) {
      const unsupportedOuterKeyword = Object.keys(value).find(
        (propertyKey) =>
          !new Set(["anyOf", "title", "description"]).has(propertyKey),
      )
      if (unsupportedOuterKeyword) {
        return `Field “${key}” uses the unsupported keyword “${unsupportedOuterKeyword}”.`
      }
    }
    const type =
      typedValue.type === "string" && typedValue.format === "date"
        ? "date"
        : typedValue.type === "string" && typedValue.format === "date-time"
          ? "date-time"
          : typedValue.type
    if (!fieldTypes.includes(type as (typeof fieldTypes)[number])) {
      return `Field “${key}” uses an unsupported type or format.`
    }
    const supportedPropertyKeywords = new Set(["type", "title", "description"])
    if (type === "string") {
      supportedPropertyKeywords.add("minLength")
      supportedPropertyKeywords.add("maxLength")
      supportedPropertyKeywords.add("enum")
    }
    if (type === "date" || type === "date-time") {
      supportedPropertyKeywords.add("format")
    }
    if (type === "number" || type === "integer") {
      supportedPropertyKeywords.add("minimum")
      supportedPropertyKeywords.add("maximum")
    }
    const unsupportedPropertyKeyword = Object.keys(typedValue).find(
      (propertyKey) => !supportedPropertyKeywords.has(propertyKey),
    )
    if (unsupportedPropertyKeyword) {
      return `Field “${key}” uses the unsupported keyword “${unsupportedPropertyKeyword}”.`
    }
    if (
      typedValue.enum !== undefined &&
      (!Array.isArray(typedValue.enum) ||
        !typedValue.enum.every((item: unknown) => typeof item === "string"))
    ) {
      return `Field “${key}” has unsupported allowed values.`
    }
  }
  return null
}

function emptyField(): CustomField {
  return {
    key: "",
    title: "",
    description: "",
    type: "string",
    required: false,
    nullable: false,
    minLength: undefined,
    maxLength: undefined,
    minimum: undefined,
    maximum: undefined,
    enumValues: "",
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function fieldsFromSchema(
  schema: CategoryDataSchemaPublic | null,
): CustomField[] {
  if (!schema?.schema || typeof schema.schema !== "object") return []
  const definition = schema.schema as Record<string, unknown>
  const properties = definition.properties
  const required = new Set(
    Array.isArray(definition.required)
      ? definition.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )
  if (!properties || typeof properties !== "object") return []

  return Object.entries(properties).flatMap(([key, value]) => {
    if (!value || typeof value !== "object") return []
    const property = value as JsonSchemaProperty
    const { value: typedProperty, nullable } =
      unwrapNullablePropertySchema(property)
    const type =
      typedProperty.type === "string" && typedProperty.format === "date"
        ? "date"
        : typedProperty.type === "string" &&
            typedProperty.format === "date-time"
          ? "date-time"
          : typedProperty.type
    if (!fieldTypes.includes(type as (typeof fieldTypes)[number])) return []
    return [
      {
        key,
        title: typeof property.title === "string" ? property.title : "",
        description:
          typeof property.description === "string" ? property.description : "",
        type: type as CustomField["type"],
        required: required.has(key),
        nullable,
        minLength: asNumber(typedProperty.minLength),
        maxLength: asNumber(typedProperty.maxLength),
        minimum: asNumber(typedProperty.minimum),
        maximum: asNumber(typedProperty.maximum),
        enumValues: Array.isArray(typedProperty.enum)
          ? typedProperty.enum
              .filter(
                (item: unknown): item is string => typeof item === "string",
              )
              .join(", ")
          : "",
      },
    ]
  })
}

function toSchema(fields: CustomFieldsForm["fields"]) {
  const properties = Object.fromEntries(
    fields.map((field) => {
      const property: JsonSchemaProperty = {
        type:
          field.type === "date" || field.type === "date-time"
            ? "string"
            : field.type,
      }
      if (field.type === "date" || field.type === "date-time") {
        property.format = field.type
      }
      if (field.nullable) {
        const nullableProperty: JsonSchemaProperty = {
          anyOf: [property, { type: "null" }],
        }
        if (field.title) nullableProperty.title = field.title
        if (field.description) nullableProperty.description = field.description
        return [field.key, nullableProperty]
      }
      if (field.title) property.title = field.title
      if (field.description) property.description = field.description
      if (field.type === "string") {
        if (field.minLength !== undefined) property.minLength = field.minLength
        if (field.maxLength !== undefined) property.maxLength = field.maxLength
        const values = field.enumValues
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
        if (values?.length) property.enum = values
      }
      if (field.type === "number" || field.type === "integer") {
        if (field.minimum !== undefined) property.minimum = field.minimum
        if (field.maximum !== undefined) property.maximum = field.maximum
      }
      return [field.key, property]
    }),
  )
  return {
    type: "object",
    properties,
    required: fields
      .filter((field) => field.required)
      .map((field) => field.key),
    additionalProperties: false,
  }
}

function NumberInput({
  value,
  onChange,
  integer = false,
  placeholder,
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  integer?: boolean
  placeholder: string
}) {
  return (
    <Input
      type="number"
      step={integer ? "1" : "any"}
      min={integer ? 0 : undefined}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => {
        const nextValue = event.target.value
        onChange(nextValue === "" ? undefined : Number(nextValue))
      }}
    />
  )
}

export function CategoryCustomFieldsBuilder({
  ledgerId,
  category,
}: {
  ledgerId: string
  category: CategoryPublic
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const storageKey = draftKey(ledgerId, category.id)
  const jsonStorageKey = jsonDraftKey(ledgerId, category.id)
  const [hasInitialized, setHasInitialized] = useState(false)
  const [hasJsonInitialized, setHasJsonInitialized] = useState(false)
  const [hasDraft, setHasDraft] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.localStorage.getItem(storageKey)),
  )
  const [hasJsonDraft, setHasJsonDraft] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.localStorage.getItem(jsonStorageKey)),
  )
  const [editor, setEditor] = useState<"fields" | "json">("fields")
  const [jsonText, setJsonText] = useState("")
  const [_appliedJsonText, setAppliedJsonText] = useState("")
  const [appliedSchema, setAppliedSchema] = useState<JsonSchemaProperty | null>(
    null,
  )
  const [jsonDirty, setJsonDirty] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const schemaQuery = useQuery({
    queryKey: ["category-data-schema", ledgerId, category.id],
    queryFn: async () => {
      try {
        return await CategoriesService.readCategoryDataSchema({
          ledgerId,
          categoryId: category.id,
        })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    retry: false,
  })
  const form = useForm<CustomFieldsForm>({
    resolver: zodResolver(customFieldsSchema),
    defaultValues: { fields: [] },
  })
  const fields = useFieldArray({ control: form.control, name: "fields" })
  const unsupportedReason =
    schemaQuery.data === undefined || appliedSchema === null
      ? null
      : unsupportedSchemaReason({
          schema: appliedSchema,
        } as CategoryDataSchemaPublic)

  useEffect(() => {
    if (!hasInitialized && schemaQuery.data !== undefined) {
      form.reset(
        readDraft(storageKey) ?? { fields: fieldsFromSchema(schemaQuery.data) },
      )
      setHasInitialized(true)
    }
  }, [form, hasInitialized, schemaQuery.data, storageKey])

  useEffect(() => {
    if (!hasJsonInitialized && schemaQuery.data !== undefined) {
      const definition = schemaQuery.data?.schema ?? toSchema([])
      const jsonDraft = readJsonDraft(jsonStorageKey)
      let restoredSchema: JsonSchemaProperty | null = null
      try {
        const parsed: unknown = JSON.parse(jsonDraft ?? "null")
        if (isRecord(parsed)) restoredSchema = parsed
      } catch {
        // Keep the text draft for correction; the server schema remains applied.
      }
      if (jsonDraft !== null && restoredSchema === null) {
        setJsonDirty(true)
        setJsonError("Apply valid JSON before saving a new version.")
      }
      const initialSchema = restoredSchema ?? definition
      const formatted = JSON.stringify(initialSchema, null, 2)
      setAppliedSchema(initialSchema)
      setJsonText(jsonDraft ?? formatted)
      setAppliedJsonText(formatted)
      setHasJsonInitialized(true)
    }
  }, [hasJsonInitialized, jsonStorageKey, schemaQuery.data])

  useEffect(() => {
    if (unsupportedReason) setEditor("json")
  }, [unsupportedReason])

  useEffect(() => {
    if (!hasInitialized) return

    const subscription = form.watch((values, { name }) => {
      if (!name) return
      const draft = customFieldsDraftSchema.safeParse(values)
      if (!draft.success) return
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(draft.data))
        const schema = JSON.stringify(toSchema(draft.data.fields), null, 2)
        setAppliedSchema(JSON.parse(schema) as JsonSchemaProperty)
        window.localStorage.setItem(jsonStorageKey, schema)
        setJsonText(schema)
        setAppliedJsonText(schema)
        setJsonDirty(false)
        setHasDraft(true)
      } catch {
        // Saving the schema still works when browser storage is unavailable.
      }
    })

    return () => subscription.unsubscribe()
  }, [form, hasInitialized, jsonStorageKey, storageKey])

  const hasUnsavedChanges = form.formState.isDirty || hasDraft || hasJsonDraft
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedChanges,
    enableBeforeUnload: () => hasUnsavedChanges,
    withResolver: true,
  })

  const discardChanges = () => {
    window.localStorage.removeItem(storageKey)
    window.localStorage.removeItem(jsonStorageKey)
    form.reset({ fields: fieldsFromSchema(schemaQuery.data ?? null) })
    setJsonText(
      JSON.stringify(schemaQuery.data?.schema ?? toSchema([]), null, 2),
    )
    setAppliedSchema(schemaQuery.data?.schema ?? toSchema([]))
    setHasDraft(false)
    setHasJsonDraft(false)
    setJsonDirty(false)
    setJsonError(null)
  }

  const updateJsonText = (value: string) => {
    setJsonText(value)
    setJsonDirty(true)
    setJsonError(null)
    try {
      window.localStorage.setItem(jsonStorageKey, value)
      setHasJsonDraft(true)
    } catch {
      // Saving the schema still works when browser storage is unavailable.
    }
  }

  const saveSchema = useMutation({
    mutationFn: (requestBody: CategoryDataSchemaCreate) =>
      CategoriesService.createCategoryDataSchema({
        ledgerId,
        categoryId: category.id,
        requestBody,
      }),
    onSuccess: (schema) => {
      window.localStorage.removeItem(storageKey)
      window.localStorage.removeItem(jsonStorageKey)
      form.reset({ fields: fieldsFromSchema(schema) })
      setJsonText(JSON.stringify(schema.schema, null, 2))
      setAppliedJsonText(JSON.stringify(schema.schema, null, 2))
      setAppliedSchema(schema.schema)
      setHasDraft(false)
      setHasJsonDraft(false)
      setJsonError(null)
      showSuccessToast(
        `Custom fields saved as schema version ${schema.version}`,
      )
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["category-data-schema", ledgerId, category.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] }),
      ]),
  })

  if (schemaQuery.isLoading) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Loading fields…
      </p>
    )
  }

  if (schemaQuery.isError) {
    return (
      <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
        Could not load the current custom-field schema.
      </p>
    )
  }

  const applyJsonSchema = () => {
    try {
      const schema: unknown = JSON.parse(jsonText)
      if (!isRecord(schema)) {
        setJsonError("The schema must be a JSON object.")
        return
      }
      const formatted = JSON.stringify(schema, null, 2)
      setJsonText(formatted)
      setAppliedJsonText(formatted)
      setAppliedSchema(schema)
      setJsonDirty(false)
      window.localStorage.setItem(jsonStorageKey, formatted)
      setHasJsonDraft(true)
      const appliedSchema = { schema } as CategoryDataSchemaPublic
      if (!unsupportedSchemaReason(appliedSchema)) {
        form.reset({ fields: fieldsFromSchema(appliedSchema) })
      }
    } catch {
      setJsonError("Enter valid JSON before saving.")
    }
  }

  const formatJson = () => {
    try {
      const schema: unknown = JSON.parse(jsonText)
      if (!isRecord(schema)) throw new Error()
      updateJsonText(JSON.stringify(schema, null, 2))
    } catch {
      setJsonError("Enter a JSON object before formatting.")
    }
  }

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonText)
    } catch {
      setJsonError("Could not copy JSON to the clipboard.")
    }
  }

  const saveAppliedJsonSchema = () => {
    try {
      if (!appliedSchema) throw new Error()
      saveSchema.mutate({ schema: appliedSchema })
    } catch {
      setJsonError("Apply valid JSON before saving.")
    }
  }

  const openJsonEditor = () => {
    if (!hasJsonDraft && !jsonDirty) {
      setJsonText(JSON.stringify(toSchema(form.getValues().fields), null, 2))
    }
    setEditor("json")
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {schemaQuery.data
            ? `Active schema version: ${schemaQuery.data.version}`
            : "No schema has been saved yet."}
        </span>
        {hasUnsavedChanges && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setDiscardDialogOpen(true)}
          >
            Discard changes
          </Button>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={editor === "fields" ? "secondary" : "outline"}
          onClick={() => setEditor("fields")}
          disabled={Boolean(unsupportedReason)}
        >
          Edit fields
        </Button>
        <Button
          type="button"
          variant={editor === "json" ? "secondary" : "outline"}
          onClick={openJsonEditor}
        >
          Edit JSON
        </Button>
      </div>
      {editor === "json" ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-data-schema-json">JSON schema</Label>
            <textarea
              id="category-data-schema-json"
              className="border-input bg-background min-h-96 w-full rounded-md border p-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              value={jsonText}
              onChange={(event) => updateJsonText(event.target.value)}
              spellCheck={false}
            />
          </div>
          {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
          {jsonDirty && (
            <p className="text-sm text-muted-foreground">
              Apply JSON before saving a new version.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={formatJson}>
              Format JSON
            </Button>
            <Button type="button" variant="outline" onClick={copyJson}>
              Copy JSON
            </Button>
            <Button type="button" variant="outline" onClick={applyJsonSchema}>
              Apply JSON
            </Button>
            <LoadingButton
              type="button"
              loading={saveSchema.isPending}
              onClick={saveAppliedJsonSchema}
              disabled={jsonDirty}
            >
              Save as new version
            </LoadingButton>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((data) => {
            if (!unsupportedReason) {
              saveSchema.mutate({ schema: toSchema(data.fields) })
            }
          })}
        >
          {unsupportedReason && (
            <p className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              This schema is read-only in the custom-field builder.{" "}
              {unsupportedReason}
              Editing it here could remove configuration that the builder cannot
              represent.
            </p>
          )}
          <fieldset disabled={Boolean(unsupportedReason)} className="space-y-4">
            {fields.fields.length === 0 ? (
              <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
                No custom fields configured yet.
              </p>
            ) : (
              <div className="space-y-4">
                {fields.fields.map((item, index) => {
                  const field = form.watch(`fields.${index}`)
                  const isText = field.type === "string"
                  const isNumeric =
                    field.type === "number" || field.type === "integer"
                  return (
                    <section
                      key={item.id}
                      className="space-y-3 rounded-lg border p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="secondary">Field {index + 1}</Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => fields.remove(index)}
                        >
                          <Trash2 /> Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5 text-sm font-medium">
                          <Label htmlFor={`custom-field-key-${item.id}`}>
                            Field name
                          </Label>
                          <Input
                            id={`custom-field-key-${item.id}`}
                            {...form.register(`fields.${index}.key`)}
                            placeholder="meter_reading_kwh"
                          />
                          {form.formState.errors.fields?.[index]?.key && (
                            <span className="text-xs text-destructive">
                              {
                                form.formState.errors.fields[index]?.key
                                  ?.message
                              }
                            </span>
                          )}
                        </div>
                        <div className="space-y-1.5 text-sm font-medium">
                          <Label htmlFor={`custom-field-type-${item.id}`}>
                            Type
                          </Label>
                          <Select
                            value={field.type}
                            onValueChange={(value) =>
                              form.setValue(
                                `fields.${index}.type`,
                                value as CustomField["type"],
                                { shouldDirty: true },
                              )
                            }
                          >
                            <SelectTrigger
                              id={`custom-field-type-${item.id}`}
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="string">Text</SelectItem>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="integer">Integer</SelectItem>
                              <SelectItem value="boolean">Yes / no</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                              <SelectItem value="date-time">
                                Date and time
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5 text-sm font-medium">
                          <Label htmlFor={`custom-field-title-${item.id}`}>
                            Label
                          </Label>
                          <Input
                            id={`custom-field-title-${item.id}`}
                            {...form.register(`fields.${index}.title`)}
                            placeholder="Meter reading"
                          />
                        </div>
                        <label className="flex items-center gap-2 pt-7 text-sm font-medium">
                          <input
                            type="checkbox"
                            {...form.register(`fields.${index}.required`)}
                          />{" "}
                          Required
                        </label>
                        <label className="flex items-center gap-2 pt-7 text-sm font-medium">
                          <input
                            type="checkbox"
                            {...form.register(`fields.${index}.nullable`)}
                          />{" "}
                          Allow null
                        </label>
                      </div>
                      <div className="space-y-1.5 text-sm font-medium">
                        <Label htmlFor={`custom-field-description-${item.id}`}>
                          Help text
                        </Label>
                        <Input
                          id={`custom-field-description-${item.id}`}
                          {...form.register(`fields.${index}.description`)}
                          placeholder="Shown below the field"
                        />
                      </div>
                      {isText && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Label className="space-y-1.5">
                            Minimum length
                            <NumberInput
                              integer
                              value={field.minLength}
                              onChange={(value) =>
                                form.setValue(
                                  `fields.${index}.minLength`,
                                  value,
                                  {
                                    shouldDirty: true,
                                  },
                                )
                              }
                              placeholder="None"
                            />
                          </Label>
                          <Label className="space-y-1.5">
                            Maximum length
                            <NumberInput
                              integer
                              value={field.maxLength}
                              onChange={(value) =>
                                form.setValue(
                                  `fields.${index}.maxLength`,
                                  value,
                                  {
                                    shouldDirty: true,
                                  },
                                )
                              }
                              placeholder="None"
                            />
                          </Label>
                          <Label className="space-y-1.5">
                            Allowed values
                            <Input
                              {...form.register(`fields.${index}.enumValues`)}
                              placeholder="e.g. low, high"
                            />
                          </Label>
                        </div>
                      )}
                      {isNumeric && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Label className="space-y-1.5">
                            Minimum
                            <NumberInput
                              value={field.minimum}
                              onChange={(value) =>
                                form.setValue(
                                  `fields.${index}.minimum`,
                                  value,
                                  {
                                    shouldDirty: true,
                                  },
                                )
                              }
                              placeholder="None"
                            />
                          </Label>
                          <Label className="space-y-1.5">
                            Maximum
                            <NumberInput
                              value={field.maximum}
                              onChange={(value) =>
                                form.setValue(
                                  `fields.${index}.maximum`,
                                  value,
                                  {
                                    shouldDirty: true,
                                  },
                                )
                              }
                              placeholder="None"
                            />
                          </Label>
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => fields.append(emptyField())}
            >
              <Plus /> Add field
            </Button>
            <div className="flex justify-end">
              <LoadingButton type="submit" loading={saveSchema.isPending}>
                Save custom fields
              </LoadingButton>
            </div>
          </fieldset>
        </form>
      )}
      <Dialog open={blocker.status === "blocked"}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              Your changes are saved as a local draft and can be restored when
              you return to this category.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Stay on this page
            </Button>
            <Button onClick={() => blocker.proceed?.()}>Leave page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              This removes the local draft and restores the last saved schema.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscardDialogOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                discardChanges()
                setDiscardDialogOpen(false)
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
