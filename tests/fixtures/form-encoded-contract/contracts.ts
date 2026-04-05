import type { Contract, Endpoint } from "../../../dist/index.js";
import type { SubmitFormRequest } from "./models.js";
import { submitFormRequestExample } from "./models.js";

export interface FormEncodedContract extends Contract<"FormEncodedContract"> {
  SubmitForm: Endpoint<{
    method: "POST";
    route: "/api/forms";
    input: SubmitFormRequest;
    response: void;
    formEncoded: true;
    requestExamples: [typeof submitFormRequestExample];
  }>;
}
