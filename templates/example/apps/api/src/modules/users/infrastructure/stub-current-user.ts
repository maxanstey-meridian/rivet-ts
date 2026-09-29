import { CurrentUser } from "../application/ports/current-user.js";
import type { User } from "../domain/user.js";

// Local development identity. When the api is promoted to a real server,
// replace with an adapter reading the authenticated principal (e.g. a
// Hono jwt/cookie middleware sets it per request).
export class StubCurrentUser implements CurrentUser {
  public get(): Promise<User> {
    return Promise.resolve({ id: "00000000-0000-4000-8000-00000000dev0", name: "Local Dev" });
  }
}
