import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { parseScheduledEnd, parseScheduledStart } from "../_shared/live-class-schedule.ts";

const BUCKET = "recorded-class-videos";
const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;
const FILE_TYPES: Record<string, { extension: string; mimeType: string }> = {
  "video/mp4": { extension: ".mp4", mimeType: "video/mp4" },
  "video/webm": { extension: ".webm", mimeType: "video/webm" },
  "video/quicktime": { extension: ".mov", mimeType: "video/quicktime" },
};
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const COMPLETED_STATUSES = new Set(["attended", "completed", "done", "finished"]);
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

function validClassRecordingPath(path: unknown, teacherId: string, liveClassId: string): boolean {
  const prefix = `manual/${teacherId}/${liveClassId}/`;
  const value = String(path || "");
  return value.startsWith(prefix) &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:mp4|webm|mov)$/i
      .test(value.slice(prefix.length));
}

function isFinalizedUpload(
  recording: {
    id: string;
    live_class_id: string | null;
    teacher_id: string;
    storage_path: string | null;
    recording_status: string;
    recording_verified_at: string | null;
  },
  recordingId: string,
  teacherId: string,
  liveClassId: string,
  objectPath: string,
): boolean {
  return String(recording.id) === recordingId &&
    String(recording.live_class_id) === liveClassId &&
    String(recording.teacher_id) === teacherId &&
    recording.recording_status === "available" &&
    Boolean(recording.recording_verified_at) &&
    recording.storage_path === objectPath &&
    validClassRecordingPath(recording.storage_path, teacherId, liveClassId);
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

  let description: string | null;
  try {
    description = readText(body.description, "Description", 2000);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invalid lecture details." }, 400);
  }

  const recordingId = String(body.recording_id || "");
  const liveClassId = typeof body.live_class_id === "string" ? body.live_class_id : "";
  const replaceRecordingId = body.replace_recording_id === undefined || body.replace_recording_id === null
    ? null
    : String(body.replace_recording_id);
  if (body.recording_mode !== "live_class") {
    return jsonResponse({ error: "Recordings must be attached to a completed live class." }, 400);
  }
  if (!UUID_PATTERN.test(liveClassId)) {
    return jsonResponse({ error: "The upload session or live class identifier is invalid." }, 400);
  }
  if (replaceRecordingId !== null && !UUID_PATTERN.test(replaceRecordingId)) {
    return jsonResponse({ error: "The recording to replace is invalid." }, 400);
  }
  const contentType = String(body.content_type || "");
  const fileSize = body.file_size;
  const durationSeconds = body.duration_seconds;
  const fileType = FILE_TYPES[contentType];
  if (!UUID_PATTERN.test(recordingId)) {
    return jsonResponse({ error: "The upload session identifier is invalid." }, 400);
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
    console.error("Could not verify the teacher profile for recording finalization.", teacherError);
    return jsonResponse({ error: "The teacher profile could not be verified." }, 500);
  }
  if (!teacher?.id) return jsonResponse({ error: "A teacher account is required to finalize recordings." }, 403);

  const { data: liveClass, error: classError } = await adminClient
    .from("live_classes")
    .select("id, teacher_id, title, grade, class_grade, stream, subject_id, subject, chapter, topic, meeting_platform, status, start_at, end_at, class_date, start_time, duration_minutes")
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
  if (!COMPLETED_STATUSES.has(status)) {
    return jsonResponse({ error: "Only live classes marked completed can receive recordings." }, 400);
  }
  let scheduleTimeZone = "Asia/Kolkata";
  if (liveClass.start_at === null && liveClass.class_date && liveClass.start_time) {
    const { data: teacherSettings, error: settingsError } = await adminClient
      .from("teacher_settings")
      .select("timezone")
      .eq("teacher_id", teacher.id)
      .maybeSingle();
    if (settingsError) {
      if (!["42P01", "42703", "PGRST204", "PGRST205"].includes(settingsError.code || "")) {
        console.error("Could not load the teacher timezone for recording finalization.", settingsError);
        return jsonResponse({ error: "The class schedule timezone could not be verified." }, 500);
      }
    } else if (teacherSettings?.timezone) {
      scheduleTimeZone = String(teacherSettings.timezone);
    }
  }
  const start = parseScheduledStart(liveClass, scheduleTimeZone);
  if (start === null) {
    return jsonResponse({ error: "The live class has an invalid scheduled start time." }, 400);
  }
  const end = parseScheduledEnd(liveClass, start);
  if (end === null || end < start) {
    return jsonResponse({ error: "The live class has an invalid scheduled end time." }, 400);
  }
  const now = Date.now();
  if (start > now || end > now) {
    return jsonResponse({ error: "A recording can only be finalized after the live class has ended." }, 400);
  }
  if (!providerFor(liveClass.meeting_platform)) {
    return jsonResponse({ error: "The scheduled class must use Zoom or Google Meet before a recording can be finalized." }, 400);
  }
  const folder = `manual/${teacher.id}/${liveClass.id}`;
  const objectPath = `${folder}/${recordingId}${fileType.extension}`;

  const { data: existing, error: existingError } = await adminClient
    .from("recorded_classes")
    .select("id, live_class_id, teacher_id, storage_path, recording_status, recording_verified_at")
    .eq("id", recordingId)
    .maybeSingle();
  if (existingError) {
    console.error("Could not check recording finalization idempotency.", existingError);
    return jsonResponse({ error: "The recording could not be safely finalized." }, 500);
  }
  if (existing) {
    if (!isFinalizedUpload(
      existing,
      recordingId,
      String(teacher.id),
      liveClassId,
      objectPath,
    )) {
      return jsonResponse({ error: "This recording identifier is already associated with another upload." }, 409);
    }
    return jsonResponse({
      recording_id: String(existing.id),
      upload_session_id: recordingId,
      live_class_id: liveClassId,
      status: "available",
      already_finalized: true,
    });
  }

  let replacedRecording: { id: string; storage_path: string } | null = null;
  if (replaceRecordingId) {
    const { data: prior, error: priorError } = await adminClient
      .from("recorded_classes")
      .select("id, live_class_id, teacher_id, storage_path, recording_status, recording_verified_at")
      .eq("id", replaceRecordingId)
      .eq("live_class_id", liveClassId)
      .eq("teacher_id", teacher.id)
      .maybeSingle();
    if (priorError) {
      console.error("Could not verify the recording selected for replacement.", priorError);
      return jsonResponse({ error: "The existing recording could not be verified for replacement." }, 500);
    }
    if (!prior || prior.recording_status !== "available" || !prior.recording_verified_at ||
      !validClassRecordingPath(prior.storage_path, String(teacher.id), liveClassId)) {
      return jsonResponse({ error: "The verified recording to replace was not found for this class." }, 409);
    }
    if (prior.storage_path === objectPath) {
      return jsonResponse({
        recording_id: String(prior.id),
        upload_session_id: recordingId,
        live_class_id: liveClassId,
        status: "available",
        already_finalized: true,
      });
    }
    replacedRecording = { id: String(prior.id), storage_path: String(prior.storage_path) };
  } else {
    const { data: existingForClass, error: classRecordingError } = await adminClient
      .from("recorded_classes")
      .select("id")
      .eq("live_class_id", liveClassId)
      .limit(1);
    if (classRecordingError) {
      console.error("Could not confirm the class has no existing recording.", classRecordingError);
      return jsonResponse({ error: "Existing recording status could not be checked. Please retry." }, 500);
    }
    if (existingForClass?.length) {
      return jsonResponse({ error: "This class already has a recording. Refresh and use Replace Recording." }, 409);
    }
  }

  const { data: bucket, error: bucketError } = await adminClient.storage.getBucket(BUCKET);
  if (bucketError || !bucket || bucket.public) {
    console.error("Private recording storage is not available during finalization.", bucketError);
    return jsonResponse({ error: "Private recording storage is not configured correctly." }, 500);
  }
  const allowedMimeTypes = Array.isArray(bucket.allowed_mime_types)
    ? bucket.allowed_mime_types.filter((mimeType): mimeType is string =>
      typeof mimeType === "string" && Boolean(mimeType.trim())
    )
    : [];
  if (allowedMimeTypes.length &&
    !allowedMimeTypes.some((mimeType) => mimeType.trim().toLowerCase() === contentType.toLowerCase())) {
    return jsonResponse({ error: "The uploaded video MIME type is not allowed by the recording storage bucket." }, 415);
  }
  const bucketLimit = Number(bucket.file_size_limit);
  const maxFileSizeBytes = Math.min(
    PROJECT_FILE_LIMIT,
    Number.isFinite(bucketLimit) && bucketLimit > 0 ? bucketLimit : PROJECT_FILE_LIMIT,
  );
  if (fileSize > maxFileSizeBytes) {
    return jsonResponse({ error: "The uploaded file exceeds the configured storage limit." }, 413);
  }

  const fileName = `${recordingId}${fileType.extension}`;
  const { data: objects, error: listError } = await adminClient.storage
    .from(BUCKET)
    .list(folder, { limit: 100, search: fileName });
  if (listError) {
    console.error("Could not verify the uploaded recording object.", listError);
    return jsonResponse({ error: "The uploaded file could not be verified. Please retry." }, 500);
  }
  const object = (objects || []).find((entry) => entry.name === fileName);
  if (!object) {
    return jsonResponse({
      error: "Storage object check failed: no video was found at the expected recording path. Upload it again.",
    }, 409);
  }
  if (!object.metadata || typeof object.metadata !== "object") {
    return jsonResponse({
      error: "Storage metadata check failed: the uploaded video has no metadata to verify.",
    }, 422);
  }
  const metadata = object.metadata as Record<string, unknown>;
  const actualSize = Number(metadata.size);
  const actualMimeType = String(metadata.mimetype || metadata.contentType || "");
  if (!Number.isSafeInteger(actualSize) || actualSize <= 0) {
    return jsonResponse({
      error: "Storage size check failed: the uploaded video has no valid byte-size metadata.",
    }, 422);
  }
  if (actualSize > maxFileSizeBytes) {
    return jsonResponse({ error: "Storage size check failed: the uploaded video exceeds the configured limit." }, 413);
  }
  if (actualSize !== fileSize) {
    return jsonResponse({
      error: `Storage size check failed: expected ${fileSize} bytes, found ${actualSize} bytes.`,
    }, 422);
  }
  if (actualMimeType !== fileType.mimeType) {
    return jsonResponse({
      error: `Storage MIME type check failed: expected ${fileType.mimeType}, found ${actualMimeType || "missing"}.`,
    }, 422);
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

  const verifiedAt = new Date().toISOString();
  const row = {
    id: replacedRecording?.id || recordingId,
    live_class_id: liveClassId,
    teacher_id: teacher.id,
    description,
    storage_path: objectPath,
    duration_seconds: typeof durationSeconds === "number" ? Math.round(durationSeconds) : null,
    recording_status: "available",
    recording_verified_at: verifiedAt,
    ready_at: verifiedAt,
  };
  if (replacedRecording) {
    const { data: updated, error: updateError } = await adminClient
      .from("recorded_classes")
      .update(row)
      .eq("id", replacedRecording.id)
      .eq("teacher_id", teacher.id)
      .eq("live_class_id", liveClassId)
      .eq("storage_path", replacedRecording.storage_path)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      const { error: cleanupError } = await adminClient.storage.from(BUCKET).remove([objectPath]);
      if (cleanupError) {
        console.error("Could not remove a verified replacement after its database update failed.", cleanupError);
      }
      if (updateError) console.error("Could not replace the verified class recording.", updateError);
      return jsonResponse({ error: "The existing recording could not be safely replaced. Please retry." }, 500);
    }
    if (replacedRecording.storage_path !== objectPath) {
      const { error: oldObjectError } = await adminClient.storage
        .from(BUCKET)
        .remove([replacedRecording.storage_path]);
      if (oldObjectError) {
        console.error("The replacement is available, but its previous private video could not be removed.", oldObjectError);
        return jsonResponse({
          recording_id: replacedRecording.id,
          upload_session_id: recordingId,
          live_class_id: liveClassId,
          status: "available",
          cleanup_warning: "The replacement is available, but the previous private video needs administrator cleanup.",
        });
      }
    }
  } else {
    const { error: insertError } = await adminClient.from("recorded_classes").insert(row);
    if (insertError) {
      if (insertError.code === "23505") {
        const { data: duplicate, error: duplicateError } = await adminClient
          .from("recorded_classes")
          .select("id, live_class_id, teacher_id, storage_path, recording_status, recording_verified_at")
          .eq("id", recordingId)
          .maybeSingle();
        if (!duplicateError && duplicate && isFinalizedUpload(
          duplicate,
          recordingId,
          String(teacher.id),
          liveClassId,
          objectPath,
        )) {
          return jsonResponse({
            recording_id: String(duplicate.id),
            upload_session_id: recordingId,
            live_class_id: liveClassId,
            status: "available",
            already_finalized: true,
          });
        }
      }
      const { error: cleanupError } = await adminClient.storage.from(BUCKET).remove([objectPath]);
      if (cleanupError) {
        console.error("Could not remove an uploaded video after its recording row failed to save.", cleanupError);
      }
      console.error("Could not insert the verified recorded class.", insertError);
      return jsonResponse({
        error: insertError.code === "23505"
          ? "This class already has a recording. Refresh and use Replace Recording."
          : "The verified recording could not be saved. Please retry.",
      }, insertError.code === "23505" ? 409 : 500);
    }
  }

  return jsonResponse({
    recording_id: replacedRecording?.id || recordingId,
    upload_session_id: recordingId,
    live_class_id: liveClassId,
    status: "available",
    already_finalized: false,
  });
});
