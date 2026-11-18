import { arrayOf } from "../../core/schema/Schema";
import { TransferResponseSchema } from "./TransferResponseSchema";

export const GetTransfersResponseSchema = arrayOf(TransferResponseSchema);
