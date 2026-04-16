import { GeneratedClientModule } from "../../domain/generated-client-module.js";
import { HandlerGroup } from "../../domain/handler-group.js";
import { RivetContractDocument } from "../../domain/rivet-contract.js";

export abstract class LocalClientCodegen {
  public abstract generate(
    handlerGroup: HandlerGroup,
    contractDocument: RivetContractDocument,
  ): GeneratedClientModule;
}
