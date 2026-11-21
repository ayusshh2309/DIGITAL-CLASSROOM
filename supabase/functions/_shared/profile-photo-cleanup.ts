export type ProfilePhotoCleanupItem = {
  id: number;
  source_table: string;
  user_id: string;
  bucket_id: string;
  object_path: string;
  source_origin: string | null;
  lease_token: string;
};

type CleanupDependencies = {
  claim(batchSize: number): Promise<{ items?: ProfilePhotoCleanupItem[] | null; error?: unknown }>;
  remove(bucket: string, path: string): Promise<{ error?: unknown }>;
  complete(item: ProfilePhotoCleanupItem): Promise<{ error?: unknown }>;
  retry(item: ProfilePhotoCleanupItem, message: string): Promise<{ error?: unknown }>;
  block(item: ProfilePhotoCleanupItem, message: string): Promise<{ error?: unknown }>;
};

export type ProfilePhotoCleanupBatchResult = {
  claimed: number;
  completed: number;
  retried: number;
  blocked: number;
};

const bucketBySource: Record<string, string> = {
  teachers: "teacher-profile-images",
  students: "student-profile-images",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "Storage returned an unspecified error.";
}

export function classifyCleanupInvocationCheck(
  authorized: unknown,
  error: unknown,
): "authorized" | "unauthorized" | "unavailable" {
  if (error || typeof authorized !== "boolean") return "unavailable";
  return authorized ? "authorized" : "unauthorized";
}

export function isValidCleanupInvocationSecretFormat(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function validateProfilePhotoCleanupItem(
  item: ProfilePhotoCleanupItem,
  supabaseUrl: string,
): string | null {
  const expectedBucket = bucketBySource[item.source_table];
  if (!expectedBucket || item.bucket_id !== expectedBucket) {
    return "The queued source table and Storage bucket do not match.";
  }
  if (
    typeof item.user_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.user_id)
  ) {
    return "The queued profile owner UUID is invalid.";
  }
  if (
    typeof item.object_path !== "string" ||
    !item.object_path ||
    item.object_path.length > 1024 ||
    item.object_path.startsWith("/") ||
    item.object_path.endsWith("/") ||
    item.object_path.includes("//") ||
    /[%?#\\\u0000-\u001f\u007f]/.test(item.object_path) ||
    item.object_path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return "The queued Storage object path is invalid.";
  }
  if (!item.object_path.startsWith(`${item.user_id}/`)) {
    return "The queued Storage object does not belong to the deleted profile owner.";
  }
  if (typeof item.lease_token !== "string" || !item.lease_token) {
    return "The cleanup lease token is missing.";
  }

  if (item.source_origin !== null) {
    try {
      const sourceUrl = new URL(item.source_origin);
      const sourceOrigin = sourceUrl.origin;
      const projectOrigin = new URL(supabaseUrl).origin;
      if (
        sourceUrl.pathname !== "/" ||
        sourceUrl.search ||
        sourceUrl.hash ||
        sourceUrl.username ||
        sourceUrl.password ||
        sourceOrigin !== projectOrigin
      ) {
        return "The stored image URL does not belong to this Supabase project.";
      }
    } catch {
      return "The stored image URL origin is invalid.";
    }
  }

  return null;
}

export function isMissingStorageObject(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const status = Number(error.statusCode ?? error.status);
  const code = String(error.code ?? error.error ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();
  return status === 404 ||
    code === "not_found" ||
    code === "object_not_found" ||
    message.includes("object not found");
}

export async function processProfilePhotoCleanupBatch(
  dependencies: CleanupDependencies,
  supabaseUrl: string,
  batchSize = 25,
): Promise<ProfilePhotoCleanupBatchResult> {
  const { items, error: claimError } = await dependencies.claim(batchSize);
  if (claimError) throw claimError;

  const claimedItems = items || [];
  const result: ProfilePhotoCleanupBatchResult = {
    claimed: claimedItems.length,
    completed: 0,
    retried: 0,
    blocked: 0,
  };

  for (const item of claimedItems) {
    const invalidReason = validateProfilePhotoCleanupItem(item, supabaseUrl);
    if (invalidReason) {
      const { error } = await dependencies.block(item, invalidReason);
      if (error) throw error;
      result.blocked += 1;
      continue;
    }

    const { error: removeError } = await dependencies.remove(
      item.bucket_id,
      item.object_path,
    );
    if (removeError && !isMissingStorageObject(removeError)) {
      const { error } = await dependencies.retry(item, errorMessage(removeError));
      if (error) throw error;
      result.retried += 1;
      continue;
    }

    const { error: completeError } = await dependencies.complete(item);
    if (completeError) throw completeError;
    result.completed += 1;
  }

  return result;
}
