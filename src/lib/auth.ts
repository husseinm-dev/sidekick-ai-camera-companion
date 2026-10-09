import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/db";

// Server-side auth. Sessions use secure HTTP-only cookies; passwords are hashed
// by better-auth (scrypt). Set BETTER_AUTH_SECRET in .env.local.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  ...(process.env.APP_ORIGIN ? { baseURL: process.env.APP_ORIGIN } : {}),
});
