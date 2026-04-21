import { registerCommonModule } from "../modules/common/common.module.js";
import { registerMembersModule } from "../modules/members/members.module.js";

export const compose = (): void => {
  registerCommonModule();
  registerMembersModule();
};
