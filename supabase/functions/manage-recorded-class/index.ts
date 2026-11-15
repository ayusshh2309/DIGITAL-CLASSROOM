import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const BUCKET = "recorded-class-videos";
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function validStoragePath(recording: {
  id: string;
  teacher_id: string;
  live_class_id: string | null;
  storage_path: string | null;
}): boolean {
  const prefix = recording.live_class_id
    ? `manual/${recording.teacher_id}/${recording.live_class_id}/`
    : `manual/${recording.teacher_id}/subject-based/`;
  const path = String(recording.storage_path || "");
  const file = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  const expectedFile = recording.live_class_id
    ? /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:mp4|webm|mov)$/i
    : new RegExp(
      `^${recording.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(?:mp4|webm|mov)$`,
      "i",
    );
  return expectedFile.test(file);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization?.startsWith("Bearer ") || !url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "The recording management service is not configured." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "The request body must be an object." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  const recordingId = String(body.recording_id || "");
  if (!UUID_PATTERN.test(recordingId)) {
    return jsonResponse({ error: "A valid recording identifier is required." }, 400);
  }
  if (body.action !== "update_description" && body.action !== "delete") {
    return jsonResponse({ error: "The recording management action is invalid." }, 400);
  }
  let description: string | null = null;
  if (body.action === "update_description") {
    if (typeof body.description !== "string" || body.description.length > 2000) {
      return jsonResponse({ error: "Description must be text no longer than 2000 characters." }, 400);
    }
    description = body.description.trim() || null;
  }

  const token = authorization.slice("Bearer ".length);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: teacher, error: teacherError } = await adminClient
    .from("teachers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (teacherError) {
    console.error("Could not verify the teacher profile for recording management.", teacherError);
    return jsonResponse({ error: "The teacher profile could not be verified." }, 500);
  }
  if (!teacher?.id) return jsonResponse({ error: "A teacher account is required to manage recordings." }, 403);

  const { data: recording, error: recordingError } = await adminClient
    .from("recorded_classes")
    .select("id, teacher_id, live_class_id, storage_path, recording_status, recording_verified_at")
    .eq("id", recordingId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  if (recordingError) {
    console.error("Could not load the teacher-owned recording for management.", recordingError);
    return jsonResponse({ error: "The recording could not be verified." }, 500);
  }
  if (!recording) return jsonResponse({ error: "Recording not found or you do not own it." }, 404);
  if (!validStoragePath({
    id: String(recording.id),
    teacher_id: String(recording.teacher_id),
    live_class_id: recording.live_class_id ? String(recording.live_class_id) : null,
    storage_path: recording.storage_path ? String(recording.storage_path) : null,
  })) {
    console.error("Refusing to manage a recording with an invalid private Storage path.", { recordingId });
    return jsonResponse({ error: "The recording has an invalid private storage reference." }, 500);
  }

  if (body.action === "update_description") {
    const { data: updated, error: updateError } = await adminClient
      .from("recorded_classes")
      .update({ description })
      .eq("id", recordingId)
      .eq("teacher_id", teacher.id)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      console.error("Could not update the teacher-owned recording description.", updateError);
      return jsonResponse({ error: "The recording description could not be saved." }, 500);
    }
    return jsonResponse({ success: true, recording_id: recordingId });
  }

  if (recording.storage_path) {
    const { error: storageError } = await adminClient.storage
      .from(BUCKET)
      .remove([recording.storage_path]);
    if (storageError) {
      console.error("Could not remove the teacher-owned recording video.", storageError);
      return jsonResponse({ error: "The private video could not be removed. The recording is unchanged." }, 500);
    }
  }
  const { data: deleted, error: deleteError } = await adminClient
    .from("recorded_classes")
    .delete()
    .eq("id", recordingId)
    .eq("teacher_id", teacher.id)
    .select("id")
    .maybeSingle();
  if (deleteError || !deleted) {
    console.error("The video was removed, but its recording row could not be deleted.", deleteError);
    return jsonResponse({ error: "The video was removed, but recording details could not be deleted. Retry the delete action." }, 500);
  }
  return jsonResponse({ success: true, recording_id: recordingId });
});
