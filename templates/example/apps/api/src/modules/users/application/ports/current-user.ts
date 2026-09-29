import type { User } from "../../domain/user.js";

export abstract class CurrentUser {
  private constructor() {}

  abstract get(): Promise<User>;
}
