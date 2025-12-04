import type { ValidationError } from "../types"
import { validateMembers } from "./solana"

export interface FormValidationResult {
  isValid: boolean
  errors: ValidationError[]
}

/**
 * Validates the create multisig form
 */
export function validateCreateMultisigForm(name: string, threshold: number, members: string[]): FormValidationResult {
  const errors: ValidationError[] = []

  // Validate name
  if (!name.trim()) {
    errors.push({
      field: "name",
      message: "Multisig name is required",
    })
  }

  // Validate threshold
  if (threshold < 1) {
    errors.push({
      field: "threshold",
      message: "Threshold must be at least 1",
    })
  }

  // Filter out empty members
  const validMembers = members.filter((member) => member.trim())

  // Validate threshold vs members count
  if (threshold > validMembers.length) {
    errors.push({
      field: "threshold",
      message: `Threshold cannot exceed number of members (${validMembers.length})`,
    })
  }

  // Validate members
  if (validMembers.length === 0) {
    errors.push({
      field: "members",
      message: "At least one member is required",
    })
  } else {
    const memberErrors = validateMembers(validMembers)
    errors.push(...memberErrors)
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
