import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const BUCKET = "recorded-class-videos";
const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;
const FILE_TYPES: Record<string, { extension: string; mimeType: string }> = {
  "video/mp4": { extension: ".mp4", mimeType: "video/mp4" },
  "video/webm": { extension: ".webm", mimeType: "video/webm" },
  "video/quicktime": { extension: ".mov", mimeType: "video/quicktime" },
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function providerFor(value: unknown): string | null {
  const platform = String(value || "").trim().toLowerCase();
  if (platform.includes("zoom")) return "Zoom";
  if (platform.includes("google") || platform.includes("meet")) return "Google Meet";
  return null;
}

function readText(value: unknown, field: string, maximum: number, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > maximum) throw new Error(`${field} must be ${maximum} characters or fewer.`);
  return text || null;
}

function matchesContainerSignature(
  bytes: Uint8Array,
  mimeType: string,
): boolean {
  if (mimeType === "video/webm") {
    return bytes.length >= 4 &&
      bytes[0] === 0x1a && bytes[1] === 0x45 &&
      bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  if (bytes.length < 12 ||
    String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") return false;
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  return mimeType === "video/quicktime"
    ? brand === "qt  "
    : brand !== "qt  ";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization?.startsWith("Bearer ") || !url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "The recording upload service is not configured." }, 500);
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

  let title: string | null;
  let chapter: string | null;
  let topic: string | null;
  let description: string | null;
  try {
    title = readText(body.title, "Lecture title", 180, true);
    chapter = readText(body.chapter, "Chapter", 180);
    topic = readText(body.topic, "Topic", 180);
    description = readText(body.description, "Description", 2000);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invalid lecture details." }, 400);
  }

  const recordingId = String(body.recording_id || "");
  const liveClassId = String(body.live_class_id || "");
  const contentType = String(body.content_type || "");
  const fileSize = body.file_size;
  const durationSeconds = body.duration_seconds;
  const fileType = FILE_TYPES[contentType];
  if (!UUID_PATTERN.test(recordingId) || !UUID_PATTERN.test(liveClassId)) {
    return jsonResponse({ error: "The upload session or live class identifier is invalid." }, 400);
  }
  if (!fileType) return jsonResponse({ error: "The uploaded file type is not supported." }, 400);
  if (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return jsonResponse({ error: "The uploaded file size is invalid." }, 400);
  }
  if (durationSeconds !== null && durationSeconds !== undefined &&
    (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 || durationSeconds > 86_400)) {
    return jsonResponse({ error: "The video duration is invalid." }, 400);
  }

  let recordingStartedAt: string | null = null;
  if (body.recording_started_at !== null && body.recording_started_at !== undefined && body.recording_started_at !== "") {
    if (typeof body.recording_started_at !== "string") {
      return jsonResponse({ error: "The recording start time is invalid." }, 400);
    }
    const timestamp = new Date(body.recording_started_at);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now()) {
      return jsonResponse({ error: "The recording start time must be a valid time in the past." }, 400);
    }
    recordingStartedAt = timestamp.toISOString();
  }

  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
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
    console.error("Could not verify the teacher profile for recording finalization.", teacherError);
    return jsonResponse({ error: "The teacher profile could not be verified." }, 500);
  }
  if (!teacher?.id) return jsonResponse({ error: "A teacher account is required to finalize recordings." }, 403);

  const { data: liveClass, error: classError } = await adminClient
    .from("live_classes")
    .select("id, teacher_id, title, grade, class_grade, stream, subject_id, subject, chapter, topic, description, meeting_platform, status, start_at, end_at, class_date, start_time, duration_minutes")
    .eq("id", liveClassId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  if (classError) {
    console.error("Could not verify live class ownership during recording finalization.", classError);
    return jsonResponse({ error: "The live class could not be verified." }, 500);
  }
  if (!liveClass) return jsonResponse({ error: "Live class not found or you do not own it." }, 403);

  const status = String(liveClass.status || "").trim().toLowerCase();
  if (["cancelled", "canceled"].includes(status)) {
    return jsonResponse({ error: "Cancelled live classes cannot receive recordings." }, 400);
  }
  const start = liveClass.start_at ? new Date(liveClass.start_at).getTime() : NaN;
  const end = liveClass.end_at
    ? new Date(liveClass.end_at).getTime()
    : Number.isFinite(start)
      ? start + (Number(liveClass.duration_minutes) || 60) * 60_000
      : NaN;
  if (!["completed", "done", "finished", "attended"].includes(status) &&
    (!Number.isFinite(end) || end > Date.now())) {
    return jsonResponse({ error: "A recording can only be finalized after the live class has ended." }, 400);
  }
  const provider = providerFor(liveClass.meeting_platform);
  if (!provider) {
    return jsonResponse({ error: "The scheduled class must use Zoom or Google Meet before a recording can be finalized." }, 400);
  }

  const objectPath = `manual/${teacher.id}/${liveClass.id}/${recordingId}${fileType.extension}`;
  const { data: existing, error: existingError } = await adminClient
    .from("recorded_classes")
    .select("id, storage_path")
    .eq("id", recordingId)
    .maybeSingle();
  if (existingError) {
    console.error("Could not check recording finalization idempotency.", existingError);
    return jsonResponse({ error: "The recording could not be safely finalized." }, 500);
  }
  if (existing) {
    if (existing.storage_path !== objectPath) {
      return jsonResponse({ error: "This recording identifier is already associated with another upload." }, 409);
    }
    return jsonResponse({ recording_id: recordingId, status: "available", already_finalized: true });
  }

  const { data: bucket, error: bucketError } = await adminClient.storage.getBucket(BUCKET);
  if (bucketError || !bucket || bucket.public) {
    console.error("Private recording storage is not available during finalization.", bucketError);
    return jsonResponse({ error: "Private recording storage is not configured correctly." }, 500);
  }
  const bucketLimit = Number(bucket.file_size_limit);
  const maxFileSizeBytes = Math.min(
    PROJECT_FILE_LIMIT,
    Number.isFinite(bucketLimit) && bucketLimit > 0 ? bucketLimit : PROJECT_FILE_LIMIT,
  );
  if (fileSize > maxFileSizeBytes) {
    return jsonResponse({ error: "The uploaded file exceeds the configured storage limit." }, 413);
  }

  const folder = `manual/${teacher.id}/${liveClass.id}`;
  const fileName = `${recordingId}${fileType.extension}`;
  const { data: objects, error: listError } = await adminClient.storage
    .from(BUCKET)
    .list(folder, { limit: 100, search: fileName });
  if (listError) {
    console.error("Could not verify the uploaded recording object.", listError);
    return jsonResponse({ error: "The uploaded file could not be verified. Please retry." }, 500);
  }
  const object = (objects || []).find((entry) => entry.name === fileName);
  if (!object || !object.metadata || typeof object.metadata !== "object") {
    return jsonResponse({ error: "The video upload is incomplete or could not be found. Upload it again." }, 409);
  }
  const metadata = object.metadata as Record<string, unknown>;
  const actualSize = Number(metadata.size);
  const actualMimeType = String(metadata.mimetype || metadata.contentType || "");
  if (!Number.isSafeInteger(actualSize) || actualSize !== fileSize || actualSize <= 0 ||
    actualSize > maxFileSizeBytes || actualMimeType !== fileType.mimeType) {
    return jsonResponse({ error: "The uploaded video's size or media type did not match the validated file." }, 422);
  }
  const { data: probeUrl, error: probeUrlError } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 60);
  if (probeUrlError || !probeUrl?.signedUrl) {
    console.error("Could not inspect the uploaded recording's media header.", probeUrlError);
    return jsonResponse({ error: "The uploaded video's file type could not be verified. Please retry." }, 500);
  }
  let signatureMatches = false;
  try {
    const probeResponse = await fetch(probeUrl.signedUrl, {
      headers: { Range: "bytes=0-15" },
    });
    if (probeResponse.status === 206) {
      signatureMatches = matchesContainerSignature(
        new Uint8Array(await probeResponse.arrayBuffer()),
        fileType.mimeType,
      );
    }
  } catch (error) {
    console.error("Could not read the uploaded recording's media header.", error);
    return jsonResponse({ error: "The uploaded video's file type could not be verified. Please retry." }, 500);
  }
  if (!signatureMatches) {
    return jsonResponse({ error: "The uploaded file content does not match the selected video format." }, 422);
  }

  const grade = Number(liveClass.grade ?? String(liveClass.class_grade || "").replace(/\D/g, ""));
  if (!Number.isInteger(grade) || grade < 1 || !liveClass.subject_id) {
    console.error("The owned live class is missing a usable grade or subject.", { liveClassId });
    return jsonResponse({ error: "The live class is missing required curriculum details." }, 422);
  }
  const verifiedAt = new Date().toISOString();
  const row = {
    id: recordingId,
    live_class_id: liveClass.id,
    teacher_id: teacher.id,
    title,
    description,
    grade,
    stream: liveClass.stream || null,
    subject_id: liveClass.subject_id,
    chapter,
    topic,
    provider,
    provider_recording_id: null,
    playback_url: null,
    storage_path: objectPath,
    recording_started_at: recordingStartedAt,
    started_at: liveClass.start_at || null,
    duration_seconds: typeof durationSeconds === "number" ? Math.round(durationSeconds) : null,
    recording_status: "available",
    recording_verified_at: verifiedAt,
    ready_at: verifiedAt,
  };
  const { error: insertError } = await adminClient.from("recorded_classes").insert(row);
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: duplicate, error: duplicateError } = await adminClient
        .from("recorded_classes")
        .select("id, storage_path")
        .eq("id", recordingId)
        .maybeSingle();
      if (!duplicateError && duplicate?.storage_path === objectPath) {
        return jsonResponse({ recording_id: recordingId, status: "available", already_finalized: true });
      }
    }
    console.error("Could not insert the verified recorded class.", insertError);
    return jsonResponse({ error: "The verified recording could not be saved. Please retry." }, 500);
  }

  return jsonResponse({ recording_id: recordingId, status: "available", already_finalized: false });
});
