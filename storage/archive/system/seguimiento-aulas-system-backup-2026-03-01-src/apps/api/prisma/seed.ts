import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const defaults = [
    {
      code: '202610',
      label: 'PREGRADO PRESENCIAL',
      semester: 1,
      modality: 'PP',
      executionPolicy: 'AUTO_PASS',
    },
    {
      code: '202615',
      label: 'PREGRADO DISTANCIA',
      semester: 1,
      modality: 'PD',
      executionPolicy: 'APPLIES',
    },
    {
      code: '202560',
      label: 'PREGRADO PRESENCIAL',
      semester: 2,
      modality: 'PP',
      executionPolicy: 'AUTO_PASS',
    },
    {
      code: '202565',
      label: 'PREGRADO DISTANCIA',
      semester: 2,
      modality: 'PD',
      executionPolicy: 'APPLIES',
    },
  ];

  for (const period of defaults) {
    await prisma.period.upsert({
      where: { code: period.code },
      create: period,
      update: period,
    });
  }

  console.log(`Seed completado: ${defaults.length} periodos base.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
