import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Without this, an idle client dropped by the server (e.g. Postgres shutting
// down during container stop) throws an unhandled 'error' event and crashes
// the process instead of just failing the next query.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});
