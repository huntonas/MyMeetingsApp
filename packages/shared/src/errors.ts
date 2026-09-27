import { z } from "zod";

// Each phase adds the codes its endpoints can return, together with the code that returns them.
const ERROR_CODES = ["server_error"] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  server_error: "Something went wrong on our end. Please try again in a few minutes.",
};

export const ApiErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
