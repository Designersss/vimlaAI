import { BadRequestException } from "@nestjs/common";
import type { ZodType } from "zod";

export function parseRequest<T>(schema: ZodType<T>, value: unknown, message = "Invalid request"): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new BadRequestException(message);
  }
  return parsed.data;
}
