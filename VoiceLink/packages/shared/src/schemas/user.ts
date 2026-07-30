import { z } from "zod";

// Tenant-scoped roles (per Architecture §7).
export const UserRole = z.enum(["owner", "admin", "editor", "viewer"]);

// Superadmin is the platform operator (us). Not stored in the role enum
// because it is orthogonal to tenant scoping — a superadmin user can
// belong to no tenant and still manage every tenant.
export const User = z.object({
  _id: z.string(),
  tenantId: z.string().nullable(),
  email: z.string().email(),
  role: UserRole,
  isSuperadmin: z.boolean().default(false),
  passwordHash: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// Wire-safe user shape (no passwordHash leaks)
export const PublicUser = User.omit({ passwordHash: true });

export const SignupInput = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  tenantId: z.string().optional(),
});

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const AuthToken = z.object({
  token: z.string(),
  user: PublicUser,
});

export type UserRole = z.infer<typeof UserRole>;
export type User = z.infer<typeof User>;
export type PublicUser = z.infer<typeof PublicUser>;
export type SignupInput = z.infer<typeof SignupInput>;
export type LoginInput = z.infer<typeof LoginInput>;
export type AuthToken = z.infer<typeof AuthToken>;
