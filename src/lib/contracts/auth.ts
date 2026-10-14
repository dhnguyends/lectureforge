import { z } from "zod";

export const RegisterInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});
export type RegisterInput = z.input<typeof RegisterInputSchema>;

export const SignInInputSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});
