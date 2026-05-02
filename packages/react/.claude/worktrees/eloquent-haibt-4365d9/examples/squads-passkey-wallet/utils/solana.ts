/**
 * Basic Solana address validation
 * Checks if the address is valid base58 and within the expected length range
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Remove whitespace
  const trimmed = address.trim();

  // Check length (Solana addresses are typically 32-44 characters in base58)
  if (trimmed.length < 32 || trimmed.length > 44) {
    return false;
  }

  // Basic base58 character check
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(trimmed);
}

/**
 * Shortens a Solana address for display purposes
 * Example: 8fj...Qk2
 */
export function shortAddress(address: string): string {
  if (!address || address.length < 8) {
    return address;
  }

  return `${address.slice(0, 3)}...${address.slice(-3)}`;
}

interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates a list of member addresses
 * Returns validation errors if any
 */
export function validateMembers(members: string[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();

  members.forEach((member, index) => {
    const trimmed = member.trim();

    if (!trimmed) {
      errors.push({
        field: `member-${index}`,
        message: 'Address is required',
      });
      return;
    }

    if (!isValidSolanaAddress(trimmed)) {
      errors.push({
        field: `member-${index}`,
        message: 'Invalid Solana address',
      });
      return;
    }

    if (seen.has(trimmed)) {
      errors.push({
        field: `member-${index}`,
        message: 'Duplicate address',
      });
      return;
    }

    seen.add(trimmed);
  });

  return errors;
}
