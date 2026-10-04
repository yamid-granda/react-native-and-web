-- Reverses 20261003120000_create_user_and_session. "Session" goes first
-- because its foreign key references "User".
DROP TABLE "Session";
DROP TABLE "User";