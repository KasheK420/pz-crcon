import { prisma } from "@/lib/db/client";
import { getLogger } from "@/lib/logger";

const log = getLogger().child({ mod: "seed" });

async function main(): Promise<void> {
  log.info("seeding dev data (idempotent upserts)");
  await prisma.mod.upsert({
    where: { workshopId: "3508537032" },
    update: {},
    create: {
      workshopId: "3508537032",
      modId: "NeatUI",
      name: "NeatUI Framework",
      enabled: true,
      loadOrder: 1,
    },
  });
  log.info("seed complete");
}

main()
  .catch((e) => {
    log.error({ err: e }, "seed failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
