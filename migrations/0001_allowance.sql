-- Daily scorer calls, shared by every visitor (see backend/surprisal.ts).
CREATE TABLE allowance (
  name TEXT PRIMARY KEY,
  calls INTEGER NOT NULL,
  last_ms INTEGER NOT NULL
);
