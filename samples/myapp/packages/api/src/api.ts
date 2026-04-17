import { Hono } from "hono";
import { mount } from "rivet-ts/hono";
import contract from "../generated/api.contract.json";
import type { MembersContract } from "./contract.js";
import { list } from "./handlers/list.js";
import { create } from "./handlers/create.js";

const membersApp = mount<MembersContract>(contract, {
  List: list,
  Create: create,
}, { controllerName: "members" });

export const app = new Hono();
app.route("/", membersApp);
