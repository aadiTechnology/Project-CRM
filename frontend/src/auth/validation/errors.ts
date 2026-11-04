import type { TFunction } from 'i18next'

import type { PasswordPolicy } from '../types'
import { ApiError } from '../../services/api/errors'

const PASSWORD_CODES = new Set([
  'TOO_SHORT',
  'MISSING_UPPERCASE',
  'MISSING_LOWERCASE',
  'MISSING_NUMBER',
  'MISSING_SPECIAL',
  'PASSWORD_MISMATCH',
])

export function messageForError(error: unknown, translate: TFunction) {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR' && error.message && error.message !== 'Validation failed.') {
      return error.message
    }
    return translate(`common:errors.${error.code}`, { defaultValue: error.message })
  }
  return translate('common:unexpectedError')
}

export function fieldMessages(error: ApiError, translate: TFunction, policy: PasswordPolicy | null) {
  const messages: Record<string, string> = {}
  for (const detail of error.details) {
    if (PASSWORD_CODES.has(detail.code)) {
      messages[detail.field] = translate(`validation:${detail.code}`, {
        defaultValue: detail.message,
        count: policy?.min_length ?? 8,
      })
    } else {
      messages[detail.field] = detail.message || translate(`validation:${detail.code}`, { defaultValue: 'Enter a valid value.' })
    }
  }
  return messages
}
