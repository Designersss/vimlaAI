import { z } from "zod";

export const vimlaLocaleSchema = z.enum(["ru", "en"]);
export type VimlaLocale = z.infer<typeof vimlaLocaleSchema>;

export const currentUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  phoneNumber: z.string().nullable(),
  phoneNumberVerified: z.boolean(),
  locale: vimlaLocaleSchema,
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const updateLocalePreferenceSchema = z
  .object({
    locale: vimlaLocaleSchema,
  })
  .strict();
export type UpdateLocalePreference = z.infer<typeof updateLocalePreferenceSchema>;
