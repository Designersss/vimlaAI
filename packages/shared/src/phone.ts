const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeE164(input: string): string | null {
  const compact = input.trim().replace(/[\s()-]/g, "");
  if (compact.length === 0) {
    return null;
  }

  let candidate = compact;
  if (/^8\d{10}$/.test(candidate)) {
    candidate = `+7${candidate.slice(1)}`;
  } else if (/^7\d{10}$/.test(candidate)) {
    candidate = `+${candidate}`;
  }

  if (!E164_PATTERN.test(candidate)) {
    return null;
  }

  return candidate;
}

export function isE164PhoneNumber(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function maskPhoneNumber(phone: string): string {
  if (phone.length < 6) {
    return phone;
  }

  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}
