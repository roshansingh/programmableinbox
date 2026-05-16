"use client"

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type {
  ConditionExprV1,
  PredicateField,
  PredicateOperator,
} from '@/lib/automations/types'

const predicateFields: Array<{ value: PredicateField; label: string }> = [
  { value: 'from', label: 'From' },
  { value: 'to', label: 'To' },
  { value: 'cc', label: 'CC' },
  { value: 'subject', label: 'Subject' },
  { value: 'body_text', label: 'Body' },
  { value: 'header', label: 'Header' },
  { value: 'has_attachment', label: 'Has Attachment' },
]

const operators: Array<{ value: PredicateOperator; label: string }> = [
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does Not Contain' },
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Is Not' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
  { value: 'regex', label: 'Regex' },
  { value: 'exists', label: 'Exists' },
  { value: 'not_exists', label: 'Does Not Exist' },
]

function normalize(condition: ConditionExprV1): Extract<ConditionExprV1, { type: 'condition_group' }> {
  if (condition.type === 'condition_group') return condition
  return {
    type: 'condition_group',
    version: 1,
    groupOperator: 'all',
    children: [condition],
  }
}

export function ConditionBuilder({
  condition,
  onChange,
}: {
  condition: ConditionExprV1
  onChange: (condition: ConditionExprV1) => void
}) {
  const group = normalize(condition)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Match mode</Label>
        <Select
          value={group.groupOperator}
          onValueChange={(value: 'all' | 'any') =>
            onChange({
              ...group,
              groupOperator: value,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All conditions</SelectItem>
            <SelectItem value="any">Any condition</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {group.children.map((child, index) => {
          const predicate =
            child.type === 'predicate'
              ? child
              : {
                  type: 'predicate' as const,
                  version: 1 as const,
                  field: 'subject' as const,
                  operator: 'contains' as const,
                  value: '',
                }

          return (
            <div key={index} className="space-y-3 rounded-lg border p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Field</Label>
                  <Select
                    value={predicate.field}
                    onValueChange={(value: PredicateField) => {
                      const next = [...group.children]
                      next[index] = {
                        ...predicate,
                        field: value,
                        value: value === 'has_attachment' ? true : '',
                        headerName: value === 'header' ? predicate.headerName ?? '' : undefined,
                      }
                      onChange({ ...group, children: next })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {predicateFields.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Operator</Label>
                  <Select
                    value={predicate.operator}
                    onValueChange={(value: PredicateOperator) => {
                      const next = [...group.children]
                      next[index] = {
                        ...predicate,
                        operator: value,
                      }
                      onChange({ ...group, children: next })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((operator) => (
                        <SelectItem key={operator.value} value={operator.value}>
                          {operator.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {predicate.field === 'header' ? (
                <div className="space-y-2">
                  <Label>Header name</Label>
                  <Input
                    value={predicate.headerName ?? ''}
                    onChange={(event) => {
                      const next = [...group.children]
                      next[index] = {
                        ...predicate,
                        headerName: event.target.value,
                      }
                      onChange({ ...group, children: next })
                    }}
                  />
                </div>
              ) : null}

              {predicate.field === 'has_attachment' ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="text-sm font-medium">Has attachment</div>
                  <Switch
                    checked={Boolean(predicate.value)}
                    onCheckedChange={(checked) => {
                      const next = [...group.children]
                      next[index] = {
                        ...predicate,
                        value: checked,
                      }
                      onChange({ ...group, children: next })
                    }}
                  />
                </div>
              ) : predicate.operator !== 'exists' && predicate.operator !== 'not_exists' ? (
                <div className="space-y-2">
                  <Label>Value</Label>
                  <Input
                    value={String(predicate.value ?? '')}
                    onChange={(event) => {
                      const next = [...group.children]
                      next[index] = {
                        ...predicate,
                        value: event.target.value,
                      }
                      onChange({ ...group, children: next })
                    }}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <Button
        variant="outline"
        onClick={() =>
          onChange({
            ...group,
            children: [
              ...group.children,
              {
                type: 'predicate',
                version: 1,
                field: 'subject',
                operator: 'contains',
                value: '',
              },
            ],
          })
        }
      >
        Add Condition
      </Button>
    </div>
  )
}
