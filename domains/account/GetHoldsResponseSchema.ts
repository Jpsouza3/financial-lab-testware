import { arrayOf } from "../../core/schema/Schema";
import { HoldResponseSchema } from "./HoldResponseSchema";

export const GetHoldsResponseSchema = arrayOf(HoldResponseSchema);
