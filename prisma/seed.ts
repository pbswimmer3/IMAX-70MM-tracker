import { PrismaClient } from "@prisma/client";
import { THEATRES, ODYSSEY_MOVIE } from "../lib/theatres";

const prisma = new PrismaClient();

async function main() {
  for (const theatre of THEATRES) {
    await prisma.theatre.upsert({
      where: { chain_externalId: { chain: theatre.chain, externalId: theatre.externalId } },
      update: {
        name: theatre.name,
        city: theatre.city,
        priority: theatre.priority,
        showtimesUrl: theatre.showtimesUrl,
      },
      create: {
        chain: theatre.chain,
        name: theatre.name,
        city: theatre.city,
        externalId: theatre.externalId,
        priority: theatre.priority,
        showtimesUrl: theatre.showtimesUrl,
      },
    });
  }

  await prisma.movie.upsert({
    where: { slug: ODYSSEY_MOVIE.slug },
    update: {
      title: ODYSSEY_MOVIE.title,
      active: ODYSSEY_MOVIE.active,
      matchers: ODYSSEY_MOVIE.matchers,
    },
    create: {
      title: ODYSSEY_MOVIE.title,
      slug: ODYSSEY_MOVIE.slug,
      active: ODYSSEY_MOVIE.active,
      matchers: ODYSSEY_MOVIE.matchers,
    },
  });

  console.log(`Seeded ${THEATRES.length} theatres and "The Odyssey" movie.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
