// Підвантаження .env для bot-server.ts. Має імпортуватися ПЕРШИМ: деякі модулі читають
// process.env ще під час імпорту (напр. TABLE_PREFIX у storage.ts), а ESM виконує
// імпорти по черзі — dotenv.config() у тілі bot-server.ts спрацював би запізно.
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ],
});
