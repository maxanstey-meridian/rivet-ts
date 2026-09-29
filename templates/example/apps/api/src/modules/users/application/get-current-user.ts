import type { User } from "../domain/user.js";
import { CurrentUser } from "./ports/current-user.js";

export class GetCurrentUser {
  public static inject = ["currentUser"] as const;

  public constructor(private readonly currentUser: CurrentUser) {}

  public execute(): Promise<User> {
    return this.currentUser.get();
  }
}
