-- Academic profiles and their disciplines; every user belongs to one.
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anyDiscipline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Profile_key_key" ON "Profile"("key");
CREATE UNIQUE INDEX "Profile_name_key" ON "Profile"("name");

CREATE TABLE "Discipline" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Discipline_profileId_name_key" ON "Discipline"("profileId", "name");
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "profileId" UUID;
CREATE INDEX "User_profileId_idx" ON "User"("profileId");
ALTER TABLE "User" ADD CONSTRAINT "User_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Built-in profiles.
INSERT INTO "Profile" ("id", "key", "name", "anyDiscipline", "updatedAt") VALUES
    (gen_random_uuid(), 'business_school', 'Business School', false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'engineering', 'Engineering', false, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'research', 'Research', true, CURRENT_TIMESTAMP);

INSERT INTO "Discipline" ("id", "profileId", "name", "order")
SELECT gen_random_uuid(), p."id", d.name, d.ord
FROM "Profile" p
JOIN (VALUES
    ('business_school', 'Business administration', 1),
    ('business_school', 'Management', 2),
    ('business_school', 'Finance', 3),
    ('business_school', 'Marketing', 4),
    ('business_school', 'Accounting', 5),
    ('business_school', 'Economics', 6),
    ('business_school', 'International business', 7),
    ('business_school', 'Entrepreneurship', 8),
    ('engineering', 'Computer engineering', 1),
    ('engineering', 'Mechanical engineering', 2),
    ('engineering', 'Electrical engineering', 3),
    ('engineering', 'Civil engineering', 4),
    ('engineering', 'Industrial engineering', 5),
    ('engineering', 'Energy', 6),
    ('engineering', 'Materials science', 7)
) AS d(key, name, ord) ON d.key = p."key";

-- Existing accounts start as Research (no restriction); the admin can change it.
UPDATE "User" SET "profileId" = (SELECT "id" FROM "Profile" WHERE "key" = 'research') WHERE "profileId" IS NULL;
