import { handleRecoveryRequest } from "../_shared/recovery-codes.ts";

Deno.serve((request) => handleRecoveryRequest(request, "regenerate"));
