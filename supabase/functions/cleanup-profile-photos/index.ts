import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyCleanupInvocationCheck,
  isValidCleanupInvocationSecretFormat,
  processProfilePhotoCleanupBatch,
  type ProfilePhotoCleanupItem,
} from "../_shared/profile-photo-cleanup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-profile-cleanup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: corsHeaders },
    );
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const providedSecret = request.headers.get("x-profile-cleanup-secret") || "";
  if (!url || !serviceRoleKey) {
    console.error("Profile photo cleanup worker secrets are not configured.");
    return Response.json(
      { error: "Profile photo cleanup is not configured." },
      { status: 500, headers: corsHeaders },
    );
  }
  if (!isValidCleanupInvocationSecretFormat(providedSecret)) {
    return Response.json(
      { error: "Unauthorized." },
      { status: 401, headers: corsHeaders },
    );
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: authorized, error: secretError } = await client.rpc(
      "verify_profile_photo_cleanup_invocation_secret",
      { p_provided_secret: providedSecret },
    );
    const invocationCheck = classifyCleanupInvocationCheck(
      authorized,
      secretError,
    );
    if (invocationCheck === "unavailable") {
      console.error("Profile photo cleanup invocation configuration is unavailable.", {
        code: secretError?.code || null,
      });
      return Response.json(
        { error: "Profile photo cleanup is not configured." },
        { status: 503, headers: corsHeaders },
      );
    }
    if (invocationCheck === "unauthorized") {
      return Response.json(
        { error: "Unauthorized." },
        { status: 401, headers: corsHeaders },
      );
    }

    const result = await processProfilePhotoCleanupBatch({
      async claim(batchSize) {
        const { data, error } = await client.rpc(
          "claim_profile_photo_cleanup_batch",
          { p_batch_size: batchSize },
        );
        return { items: data as ProfilePhotoCleanupItem[] | null, error };
      },
      async remove(bucket, path) {
        const { error } = await client.storage.from(bucket).remove([path]);
        return { error };
      },
      async complete(item) {
        const { error } = await client.rpc(
          "complete_profile_photo_cleanup",
          { p_queue_id: item.id, p_lease_token: item.lease_token },
        );
        return { error };
      },
      async retry(item, message) {
        console.error("Profile photo cleanup will be retried.", {
          queueId: item.id,
          bucket: item.bucket_id,
          path: item.object_path,
          message,
        });
        const { error } = await client.rpc(
          "retry_profile_photo_cleanup",
          {
            p_queue_id: item.id,
            p_lease_token: item.lease_token,
            p_error: message,
          },
        );
        return { error };
      },
      async block(item, message) {
        console.error("Profile photo cleanup was blocked for review.", {
          queueId: item.id,
          bucket: item.bucket_id,
          path: item.object_path,
          message,
        });
        const { error } = await client.rpc(
          "block_profile_photo_cleanup",
          {
            p_queue_id: item.id,
            p_lease_token: item.lease_token,
            p_error: message,
          },
        );
        return { error };
      },
    }, url);

    return Response.json(result, { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("Profile photo cleanup worker failed.", error);
    return Response.json(
      { error: "Profile photo cleanup could not be completed." },
      { status: 500, headers: corsHeaders },
    );
  }
});
