import { PrismaClient } from "@prisma/client";
import { THEATRES } from "../lib/theatres";

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
    where: { slug: "the-odyssey" },
    update: {
      title: "The Odyssey",
      active: true,
      matchers: {
        amc: {
          movieIds: ["76238", "80679"],
          attributeCodes: ["IMAX70MM", "70MM", "IMAXWITH70MM"],
          titlePattern: "odyssey",
        },
        regal: {
          hoCodes: ["ho00019076", "ho00021807"],
          titlePattern: "odyssey",
        },
      },
    },
    create: {
      title: "The Odyssey",
      slug: "the-odyssey",
      active: true,
      matchers: {
        amc: {
          movieIds: ["76238", "80679"],
          attributeCodes: ["IMAX70MM", "70MM", "IMAXWITH70MM"],
          titlePattern: "odyssey",
        },
        regal: {
          hoCodes: ["ho00019076", "ho00021807"],
          titlePattern: "odyssey",
        },
      },
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
