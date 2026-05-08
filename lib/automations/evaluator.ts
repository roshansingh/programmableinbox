import type { ConditionExprV1, EmailAutomationInput } from './types'

function getHeaderValue(headers: Record<string, string>, headerName: string): string | null {
  const expected = headerName.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) {
      return value
    }
  }
  return null
}

function getFieldValue(input: EmailAutomationInput, field: ConditionExprV1 extends infer T ? never : never) {
  return input
}

function matchesString(operator: string, haystack: string, needle: string): boolean {
  switch (operator) {
    case 'equals':
      return haystack === needle
    case 'contains':
      return haystack.includes(needle)
    case 'starts_with':
      return haystack.startsWith(needle)
    case 'ends_with':
      return haystack.endsWith(needle)
    case 'regex':
      return new RegExp(needle).test(haystack)
    case 'exists':
      return haystack.length > 0
    default:
      return false
  }
}

export function evaluateCondition(condition: ConditionExprV1, input: EmailAutomationInput): boolean {
  if (condition.type === 'condition_group') {
    if (condition.groupOperator === 'all') {
      return condition.children.every((child) => evaluateCondition(child, input))
    }
    return condition.children.some((child) => evaluateCondition(child, input))
  }

  if (condition.field === 'has_attachment') {
    if (condition.operator === 'exists') {
      return true
    }
    return input.hasAttachment === Boolean(condition.value)
  }

  if (condition.field === 'header') {
    const headerValue = condition.headerName ? getHeaderValue(input.headers, condition.headerName) : null
    if (condition.operator === 'exists') {
      return Boolean(headerValue)
    }
    return headerValue ? matchesString(condition.operator, headerValue.toLowerCase(), String(condition.value ?? '').toLowerCase()) : false
  }

  const lookup: Record<string, string[]> = {
    from: [input.from],
    to: input.to,
    cc: input.cc,
    subject: [input.subject],
    body_text: [input.bodyText],
  }

  const candidates = lookup[condition.field] ?? []
  if (condition.operator === 'exists') {
    return candidates.some((value) => value.length > 0)
  }

  const needle = String(condition.value ?? '').toLowerCase()
  return candidates.some((candidate) => matchesString(condition.operator, candidate.toLowerCase(), needle))
}
