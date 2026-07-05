export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  notFound: (resource: string) => new AppError(404, "NOT_FOUND", `${resource} not found`),
  unauthorized: (message = "Authentication required") => new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You don't have access to this resource") => new AppError(403, "FORBIDDEN", message),
  validation: (details: unknown) => new AppError(422, "VALIDATION_ERROR", "Request validation failed", details),
  conflict: (message: string) => new AppError(409, "CONFLICT", message),
  badRequest: (message: string) => new AppError(400, "BAD_REQUEST", message),
};
