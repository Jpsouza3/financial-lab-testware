import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const env = process.env.ENV || 'hml';
const envPath = path.resolve(process.cwd(), `.env.${env}`);

if (!fs.existsSync(envPath)) {
  throw new Error(
    `Environment file not found: ${envPath}\n` +
    `Make sure the file ".env.${env}" exists in the project root.`
  );
}

const result = dotenv.config({ path: envPath, quiet: true });

if (result.error) {
  throw result.error;
}

export const config = {
  baseAuthUrl: process.env.BASE_AUTH_URL!,
  client_id: process.env.CLIENT_ID!,
  client_secret: process.env.CLIENT_SECRET!,
};