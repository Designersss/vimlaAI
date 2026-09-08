export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function passwordTooShort(value: string): boolean {
  return value.length > 0 && value.length < 8;
}
