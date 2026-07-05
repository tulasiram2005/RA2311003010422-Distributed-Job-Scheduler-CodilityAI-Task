import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/auth";
import { Errors } from "../lib/errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(Errors.unauthorized());
  }

  try {
    const token = header.slice("Bearer ".length);
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    next(Errors.unauthorized("Invalid or expired token"));
  }
}

/** Restricts a route to org members holding one of the given roles. */
export function requireRole(...roles: Array<"OWNER" | "ADMIN" | "MEMBER">) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Errors.unauthorized());
    if (!roles.includes(req.auth.role)) return next(Errors.forbidden());
    next();
  };
}
