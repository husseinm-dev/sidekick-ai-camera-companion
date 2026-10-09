import { defineConfig } from "prisma/config";

// The local SQLite file is not a secret; set DATABASE_URL to use a hosted database instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  },
});
