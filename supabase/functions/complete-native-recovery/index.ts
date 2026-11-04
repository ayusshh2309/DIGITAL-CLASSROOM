import { handleNativeRecoveryRequest } from "../_shared/native-recovery.ts";

Deno.serve((request) => handleNativeRecoveryRequest(request, "complete"));
