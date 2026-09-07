import { z } from "zod";

export const currentUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string(),
  image: z.string().nullable(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
