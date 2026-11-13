import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const BUCKET = "recorded-class-videos";
const SIGNED_URL_SECONDS = 3600;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization?.startsWith("Bearer ") || !url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "The playback service is not configured." }, 500);
  }

  let recordingId = "";
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "The request body must be an object." }, 400);
    }
    recordingId = String((body as Record<string, unknown>).recording_id || "");
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  if (!UUID_PATTERN.test(recordingId)) {
    return jsonResponse({ error: "A valid recording identifier is required." }, 400);
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
  const { data: student, error: studentError } = await adminClient
    .from("students")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (studentError) {
    console.error("Could not verify student identity for recording playback.", studentError);
    return jsonResponse({ error: "Your student profile could not be verified." }, 500);
  }
  if (!student) return jsonResponse({ error: "Student access is required for recorded classes." }, 403);

  const { data: recording, error: recordingError } = await userClient
    .from("recorded_classes")
    .select("id, live_class_id, teacher_id, grade, stream, subject_id, storage_path, recording_status")
    .eq("id", recordingId)
    .eq("recording_status", "available")
    .maybeSingle();
  if (recordingError) {
    console.error("Could not read the student-authorized recording row.", recordingError);
    return jsonResponse({ error: "The recording could not be authorized for playback." }, 500);
  }
  if (!recording) return jsonResponse({ error: "This recording is unavailable or you are not authorized to view it." }, 404);

  const expectedPrefix = `manual/${recording.teacher_id}/${recording.live_class_id}/`;
  const storagePath = String(recording.storage_path || "");
  const expectedName = `${recording.id}.`;
  if (!storagePath.startsWith(expectedPrefix) ||
    !storagePath.slice(expectedPrefix.length).startsWith(expectedName) ||
    !/\.(?:mp4|webm|mov)$/i.test(storagePath)) {
    console.error("The authorized recording contains an invalid private Storage path.", { recordingId });
    return jsonResponse({ error: "The recording has an invalid storage reference." }, 500);
  }

  const { data: signed, error: signedError } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (signedError || !signed?.signedUrl) {
    console.error("Could not issue a temporary recording playback URL.", signedError);
    return jsonResponse({ error: "A secure playback link could not be created. Please retry." }, 500);
  }

  return jsonResponse({
    playback_url: signed.signedUrl,
    expires_in: SIGNED_URL_SECONDS,
    expires_at: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
  });
});
