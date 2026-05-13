import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Lazily create the client so type-checking/build doesn't require a live URL.
const client = connectionString
  ? postgres(connectionString, { prepare: false })
  : (undefined as unknown as ReturnType<typeof postgres>);

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;
