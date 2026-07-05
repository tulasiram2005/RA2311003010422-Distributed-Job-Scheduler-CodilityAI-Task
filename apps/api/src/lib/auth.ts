import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";

export interface AccessTokenPayload {
  sub: string; // user id
  orgId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, requireEnv("JWT_SECRET"), { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, requireEnv("JWT_REFRESH_SECRET"), { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, requireEnv("JWT_SECRET")) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, requireEnv("JWT_REFRESH_SECRET")) as { sub: string };
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function comparePassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
