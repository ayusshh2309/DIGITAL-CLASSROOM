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

function parseScheduledStart(liveClass: {
  start_at: string | null;
  class_date: string | null;
  start_time: string | null;
}, timeZone: string): number | null {
  if (liveClass.start_at !== null) {
    const timestamp = Date.parse(liveClass.start_at);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (!liveClass.class_date || !liveClass.start_time ||
    !/^\d{4}-\d{2}-\d{2}$/.test(liveClass.class_date) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(liveClass.start_time)) {
    return null;
  }
  const [year, month, day] = liveClass.class_date.split("-").map(Number);
  const [hour, minute, second = "0"] = liveClass.start_time.split(":");
  const [wholeSecond, fractionalSecond = ""] = second.split(".");
  const milliseconds = Number(`0.${fractionalSecond || "0"}`) * 1000;
  const targetTimestamp = Date.UTC(
    year,
    month - 1,
    day,
    Number(hour),
    Number(minute),
    Number(wholeSecond),
    milliseconds,
  );
  if (!Number.isFinite(targetTimestamp) ||
    new Date(targetTimestamp).toISOString().slice(0, 10) !== liveClass.class_date) return null;

  let timestamp = targetTimestamp;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(timestamp)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedTimestamp = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      milliseconds,
    );
    const difference = representedTimestamp - targetTimestamp;
    if (difference === 0) return timestamp;
    timestamp -= difference;
  }
  return null;
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

  const liveClassId = String(body.live_class_id || "");
  const contentType = String(body.content_type || "");
  const fileSize = body.file_size;
  const fileType = FILE_TYPES[contentType];
  if (!UUID_PATTERN.test(liveClassId)) {
    return jsonResponse({ error: "Choose a valid live class." }, 400);
  }
  if (!fileType || body.file_extension !== fileType.extension) {
    return jsonResponse({ error: "Only MP4, WebM, and MOV / QuickTime videos are accepted." }, 400);
  }
  if (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
    return jsonResponse({ error: "The selected video file size is invalid." }, 400);
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
    console.error("Could not verify the teacher profile for recording upload.", teacherError);
    return jsonResponse({ error: "The teacher profile could not be verified." }, 500);
  }
  if (!teacher?.id) return jsonResponse({ error: "A teacher account is required to upload recordings." }, 403);

  const { data: liveClass, error: classError } = await adminClient
    .from("live_classes")
    .select("id, teacher_id, title, grade, class_grade, stream, subject_id, subject, chapter, topic, description, meeting_platform, status, start_at, end_at, class_date, start_time, duration_minutes")
    .eq("id", liveClassId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  if (classError) {
    console.error("Could not verify live class ownership for recording upload.", classError);
    return jsonResponse({ error: "The live class could not be verified." }, 500);
  }
  if (!liveClass) return jsonResponse({ error: "Live class not found or you do not own it." }, 403);

  const status = String(liveClass.status || "").trim().toLowerCase();
  if (["cancelled", "canceled"].includes(status)) {
    return jsonResponse({ error: "Cancelled live classes cannot receive recordings." }, 400);
  }
  const completedStatuses = ["completed", "done", "finished", "attended"];
  const isCompleted = completedStatuses.includes(status);
  let scheduleTimeZone = "Asia/Kolkata";
  if (liveClass.start_at === null && liveClass.class_date && liveClass.start_time) {
    const { data: teacherSettings, error: settingsError } = await adminClient
      .from("teacher_settings")
      .select("timezone")
      .eq("teacher_id", teacher.id)
      .maybeSingle();
    if (settingsError) {
      if (!["42P01", "42703", "PGRST204", "PGRST205"].includes(settingsError.code || "")) {
        console.error("Could not load the teacher timezone for live-class end-time validation.", settingsError);
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
  const now = Date.now();
  if (start !== null && start > now) {
    return jsonResponse({ error: "Recordings cannot be uploaded for a future class." }, 400);
  }
  let end: number | null = null;
  if (liveClass.end_at !== null) {
    const parsedEnd = Date.parse(liveClass.end_at);
    if (!Number.isFinite(parsedEnd)) {
      return jsonResponse({ error: "The live class has an invalid scheduled end time." }, 400);
    }
    end = parsedEnd;
  } else if (start !== null && liveClass.duration_minutes !== null) {
    const durationMinutes = Number(liveClass.duration_minutes);
    if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
      end = start + durationMinutes * 60_000;
    }
  }
  if (start !== null && end !== null && end <= start) {
    return jsonResponse({ error: "The live class has an invalid scheduled end time." }, 400);
  }
  if (!isCompleted && (start === null || end === null || end > now)) {
    return jsonResponse({ error: "A recording can only be uploaded after the live class has ended." }, 400);
  }
  if (!providerFor(liveClass.meeting_platform)) {
    return jsonResponse({ error: "The scheduled class must use Zoom or Google Meet before a recording can be uploaded." }, 400);
  }

  const { data: bucket, error: bucketError } = await adminClient.storage.getBucket(BUCKET);
  if (bucketError || !bucket) {
    console.error("Could not read the private recorded-class-videos bucket settings.", bucketError);
    return jsonResponse({ error: "The private recording storage bucket is unavailable." }, 500);
  }
  if (bucket.public) {
    console.error("The recorded-class-videos bucket is public; refusing to create an upload.");
    return jsonResponse({ error: "Recording storage is not configured as private." }, 500);
  }
  const bucketLimit = Number(bucket.file_size_limit);
  const maxFileSizeBytes = Math.min(
    PROJECT_FILE_LIMIT,
    Number.isFinite(bucketLimit) && bucketLimit > 0 ? bucketLimit : PROJECT_FILE_LIMIT,
  );
  if (Number(fileSize) > maxFileSizeBytes) {
    return jsonResponse({ error: `The video exceeds the ${Math.floor(maxFileSizeBytes / 1024 / 1024)} MiB storage limit.` }, 413);
  }

  const recordingId = crypto.randomUUID();
  const objectPath = `manual/${teacher.id}/${liveClass.id}/${recordingId}${fileType.extension}`;
  const { data: signedUpload, error: signedUploadError } = await adminClient.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (signedUploadError || !signedUpload?.signedUrl) {
    console.error("Could not create a signed recording upload URL.", signedUploadError);
    return jsonResponse({ error: "A secure upload could not be started. Please retry." }, 500);
  }

  return jsonResponse({
    recording_id: recordingId,
    upload_url: signedUpload.signedUrl,
    max_file_size_bytes: maxFileSizeBytes,
  });
});
