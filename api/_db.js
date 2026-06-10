import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'underdawg';

// Reuse the connection across serverless invocations (cold-start friendly).
let cached = global._underdawgMongo;
if (!cached) cached = global._underdawgMongo = { conn: null, promise: null, indexed: false };

export async function getDb() {
  if (cached.conn) return cached.conn;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set.');
  }
  if (!cached.promise) {
    const client = new MongoClient(uri, { maxPoolSize: 5 });
    cached.promise = client.connect().then((c) => c.db(dbName));
  }
  cached.conn = await cached.promise;

  // Ensure a case-insensitive unique index so duplicates are impossible
  // even under concurrent requests. Runs once per warm instance.
  if (!cached.indexed) {
    try {
      await cached.conn
        .collection('entries')
        .createIndex({ usernameLower: 1 }, { unique: true });
      cached.indexed = true;
    } catch {
      // Index creation is best-effort; the code-level check still applies.
    }
  }

  return cached.conn;
}
