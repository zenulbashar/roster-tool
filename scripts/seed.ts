/**
 * Seeds a demo business so you can click through the whole flow immediately:
 * an owner, a handful of staff, three shift templates, and a roster period
 * (next week) with shifts already generated.
 *
 * Re-running wipes and recreates the demo business (matched by owner email),
 * so it is safe to run repeatedly.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { businesses, users } from "../src/lib/db/schema";
import { createTenantRepo } from "../src/lib/tenant/repository";
import { eachDate, isoWeekday } from "../src/lib/time";
import { env } from "../src/lib/env";
import { logger } from "../src/lib/logger";

const OWNER_EMAIL = "owner@example.com";
const BUSINESS_NAME = "Brew & Bite Café";

const STAFF = [
  { name: "Ava Nguyen", email: "ava@example.com" },
  { name: "Ben Carter", email: "ben@example.com" },
  { name: "Chloe Smith", email: "chloe@example.com" },
  { name: "Diego Ramirez", email: "diego@example.com" },
  { name: "Ella Brown", email: "ella@example.com" },
];

// All templates run every day of the week (ISO 1=Mon … 7=Sun).
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const TEMPLATES = [
  {
    label: "Morning",
    startTime: "07:00:00",
    endTime: "12:00:00",
    weekdays: ALL_DAYS,
  },
  {
    label: "Afternoon",
    startTime: "12:00:00",
    endTime: "17:00:00",
    weekdays: ALL_DAYS,
  },
  {
    label: "Evening",
    startTime: "17:00:00",
    endTime: "22:00:00",
    weekdays: ALL_DAYS,
  },
];

/** Returns the "YYYY-MM-DD" of the next Monday from today (UTC reference). */
function nextMonday(): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const add = (8 - day) % 7 || 7; // always strictly in the future
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, dd] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1, dd!));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  // Wipe any prior demo: deleting the business cascades to all its data, then
  // detach + remove the owner user.
  const existingOwner = await db
    .select()
    .from(users)
    .where(eq(users.email, OWNER_EMAIL))
    .limit(1);

  if (existingOwner[0]?.businessId) {
    await db
      .delete(businesses)
      .where(eq(businesses.id, existingOwner[0].businessId));
  }
  if (existingOwner[0]) {
    await db.delete(users).where(eq(users.email, OWNER_EMAIL));
  }

  // Business + owner.
  const [business] = await db
    .insert(businesses)
    .values({ name: BUSINESS_NAME, timezone: "Australia/Sydney" })
    .returning();

  await db.insert(users).values({
    name: "Demo Owner",
    email: OWNER_EMAIL,
    businessId: business!.id,
  });

  const repo = createTenantRepo(business!.id);

  // Staff.
  for (const s of STAFF) {
    await repo.addStaff(s);
  }

  // Shift templates.
  for (const t of TEMPLATES) {
    await repo.addTemplate(t);
  }
  const templates = await repo.listTemplates({ activeOnly: true });

  // Roster period: next week (Mon–Sun), still a draft awaiting availability.
  const startDate = nextMonday();
  const endDate = addDays(startDate, 6);
  const period = await repo.createPeriod({
    label: "Next week",
    startDate,
    endDate,
    availabilityDeadline: null,
  });

  // Expand templates into concrete shifts for each applicable day.
  const shiftRows = eachDate(startDate, endDate).flatMap((date) => {
    const wd = isoWeekday(date);
    return templates
      .filter((t) => t.weekdays.includes(wd))
      .map((t) => ({
        rosterPeriodId: period.id,
        templateId: t.id,
        date,
        label: t.label,
        startTime: t.startTime,
        endTime: t.endTime,
      }));
  });
  const createdShifts = await repo.createShifts(shiftRows);

  logger.info(
    {
      business: business!.name,
      staff: STAFF.length,
      templates: TEMPLATES.length,
      period: `${startDate} → ${endDate}`,
      shifts: createdShifts.length,
    },
    "Seed complete",
  );

  console.log(
    [
      "",
      "  Demo data ready.",
      `  Sign in as the owner with:  ${OWNER_EMAIL}`,
      `  App:     ${env.APP_URL}`,
      "  Emails:  http://localhost:8025 (Mailpit)",
      "",
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    // Close the pool so the process can exit.
    await db.$client.end();
  });
