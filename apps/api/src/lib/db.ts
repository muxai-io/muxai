import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { _prismaInstance: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// Lazy proxy — client is created on first property access, by which point
// DATABASE_URL will have been set (e.g. by startDatabase() for embedded mode)
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (!globalForPrisma._prismaInstance) {
      globalForPrisma._prismaInstance = createPrismaClient();
    }
    return Reflect.get(globalForPrisma._prismaInstance, prop);
  },
});

export { Prisma, PrismaClient } from "@prisma/client";
