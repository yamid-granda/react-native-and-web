-- Seller accounts and their sessions: the first authenticated surface in the
-- service. The marketplace itself stays public — these tables exist only to
-- answer "who is calling" and "who owns this product".
--
-- TEXT ids match the existing "Product" house style, so there is no new
-- sequence and no uuid extension for the schema to depend on.
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- A UNIQUE constraint rather than a check: the database is the thing that has
-- to make two concurrent registrations of one address impossible, so the
-- loser gets a unique-violation the handler turns into a 409.
--
-- Case-insensitivity is handled in the application (email is stored already
-- lowercased), not here — a citext extension or a functional index would make
-- the one guarantee this service draws from Postgres depend on a collation
-- nobody else in the repo shares.
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Only the SHA-256 of a session token is stored: a database leak must not hand
-- over live sessions. ON DELETE CASCADE because a deleted seller has no
-- sessions left to revoke.
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash"),
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backs the expiry sweep that reaps dead sessions; a plain index because the
-- lookup is "everything already past its expiry", not a point read.
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");