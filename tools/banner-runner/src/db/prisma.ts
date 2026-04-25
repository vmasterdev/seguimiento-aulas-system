import prismaClientModule from "@prisma/client";

const { PrismaClient } = prismaClientModule;
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

let prismaClient: PrismaClientInstance | null = null;

export function getPrismaClient(): PrismaClientInstance {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }

  return prismaClient;
}
