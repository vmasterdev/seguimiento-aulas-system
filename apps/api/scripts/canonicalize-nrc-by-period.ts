import { PrismaClient } from '@prisma/client';

function canonicalNrcByPeriod(periodCodeRaw: string, rawNrc: string): string | null {
  const periodCode = String(periodCodeRaw ?? '').replace(/[^\d]/g, '').slice(0, 6);
  const nrcRaw = String(rawNrc ?? '').trim();
  if (!periodCode || !nrcRaw) return null;

  const periodPrefix = periodCode.slice(-2);
  const explicit = nrcRaw.match(/^(\d{2})\s*-\s*(\d+)$/);
  if (explicit) {
    const number = String(Number(explicit[2]));
    return `${periodPrefix}-${number}`;
  }

  const digits = nrcRaw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const number = String(Number(digits.slice(-5)));
  return `${periodPrefix}-${number}`;
}

function rewriteSearchUrl(url: string, query: string): string {
  if (!url || !url.includes('/course/search.php')) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('q', query);
    parsed.searchParams.delete('search');
    return parsed.toString();
  } catch {
    return url;
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const periodCodeArg = args.find((arg) => !arg.startsWith('--'))?.trim() || '';

    const courses = await prisma.course.findMany({
      where: {
        period: periodCodeArg ? { code: periodCodeArg } : undefined,
      },
      include: {
        period: true,
        moodleCheck: true,
      },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    const keyToIds = new Map<string, string[]>();
    for (const course of courses) {
      const key = `${course.periodId}::${course.nrc}`;
      const list = keyToIds.get(key) ?? [];
      list.push(course.id);
      keyToIds.set(key, list);
    }

    let scanned = 0;
    let unchanged = 0;
    let updated = 0;
    let collisions = 0;
    let moodleUpdates = 0;
    const collisionSamples: Array<{
      periodCode: string;
      currentNrc: string;
      canonicalNrc: string;
      courseId: string;
      conflictCourseId: string;
    }> = [];

    for (const course of courses) {
      scanned += 1;
      const canonical = canonicalNrcByPeriod(course.period.code, course.nrc);
      if (!canonical || canonical === course.nrc) {
        unchanged += 1;
        continue;
      }

      const targetKey = `${course.periodId}::${canonical}`;
      const idsWithTargetNrc = (keyToIds.get(targetKey) ?? []).filter((id) => id !== course.id);
      if (idsWithTargetNrc.length > 0) {
        collisions += 1;
        if (collisionSamples.length < 20) {
          collisionSamples.push({
            periodCode: course.period.code,
            currentNrc: course.nrc,
            canonicalNrc: canonical,
            courseId: course.id,
            conflictCourseId: idsWithTargetNrc[0],
          });
        }
        continue;
      }

      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          await tx.course.update({
            where: { id: course.id },
            data: { nrc: canonical },
          });

          if (course.moodleCheck) {
            const nextSearchQuery = canonical;
            const nextUrl = rewriteSearchUrl(course.moodleCheck.moodleCourseUrl ?? '', nextSearchQuery);
            await tx.moodleCheck.update({
              where: { courseId: course.id },
              data: {
                searchQuery: nextSearchQuery,
                moodleCourseUrl: nextUrl || course.moodleCheck.moodleCourseUrl,
                resolvedAt: new Date(),
              },
            });
            moodleUpdates += 1;
          }
        });
      }

      const oldKey = `${course.periodId}::${course.nrc}`;
      const oldList = (keyToIds.get(oldKey) ?? []).filter((id) => id !== course.id);
      if (oldList.length) {
        keyToIds.set(oldKey, oldList);
      } else {
        keyToIds.delete(oldKey);
      }
      const newList = keyToIds.get(targetKey) ?? [];
      newList.push(course.id);
      keyToIds.set(targetKey, newList);

      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          periodCode: periodCodeArg || null,
          dryRun,
          scanned,
          unchanged,
          updated,
          collisions,
          moodleUpdates,
          collisionSamples,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
