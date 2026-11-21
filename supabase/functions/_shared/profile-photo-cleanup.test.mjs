import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCleanupInvocationCheck,
  isValidCleanupInvocationSecretFormat,
  isMissingStorageObject,
  processProfilePhotoCleanupBatch,
} from "./profile-photo-cleanup.ts";

const supabaseUrl = "https://example-project.supabase.co";
const teacherId = "a1603952-e84a-4a82-bf11-2b12ba8f89f9";
const studentId = "b2603952-e84a-4a82-bf11-2b12ba8f89f9";

function createItem(overrides = {}) {
  return {
    id: 21,
    source_table: "teachers",
    user_id: teacherId,
    bucket_id: "teacher-profile-images",
    object_path: `${teacherId}/profile-1732200000000.jpg`,
    source_origin: null,
    lease_token: "lease-1",
    ...overrides,
  };
}

function createDependencies(items, removeError = null) {
  const calls = [];
  return {
    calls,
    dependencies: {
      async claim(batchSize) {
        calls.push(["claim", batchSize]);
        return { items, error: null };
      },
      async remove(bucket, path) {
        calls.push(["remove", bucket, path]);
        return { error: removeError };
      },
      async complete(item) {
        calls.push(["complete", item.id]);
        return { error: null };
      },
      async retry(item, message) {
        calls.push(["retry", item.id, message]);
        return { error: null };
      },
      async block(item, message) {
        calls.push(["block", item.id, message]);
        return { error: null };
      },
    },
  };
}

test("teacher and student queue entries target their role-specific buckets", async () => {
  const teacher = createItem();
  const student = createItem({
    id: 22,
    source_table: "students",
    user_id: studentId,
    bucket_id: "student-profile-images",
    object_path: `${studentId}/profile-unique.png`,
  });
  const { dependencies, calls } = createDependencies([teacher, student]);

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.deepEqual(result, {
    claimed: 2,
    completed: 2,
    retried: 0,
    blocked: 0,
  });
  assert.deepEqual(
    calls.filter(([action]) => action === "remove"),
    [
      ["remove", "teacher-profile-images", teacher.object_path],
      ["remove", "student-profile-images", student.object_path],
    ],
  );
});

test("secret mismatch is unauthorized and unavailable secret configuration fails closed", () => {
  assert.equal(isValidCleanupInvocationSecretFormat("x".repeat(32)), true);
  assert.equal(isValidCleanupInvocationSecretFormat("x".repeat(31)), false);
  assert.equal(isValidCleanupInvocationSecretFormat("x".repeat(129)), false);
  assert.equal(isValidCleanupInvocationSecretFormat("x".repeat(31) + "!"), false);
  assert.equal(
    classifyCleanupInvocationCheck(false, null),
    "unauthorized",
  );
  assert.equal(
    classifyCleanupInvocationCheck(null, { code: "VAULT_SECRET_MISSING" }),
    "unavailable",
  );
  assert.equal(
    classifyCleanupInvocationCheck(true, null),
    "authorized",
  );
});

test("a missing Storage object is treated as an idempotent success", async () => {
  const { dependencies, calls } = createDependencies(
    [createItem()],
    { statusCode: "404", message: "Object not found" },
  );

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(isMissingStorageObject({ statusCode: "404" }), true);
  assert.equal(result.completed, 1);
  assert.equal(result.retried, 0);
  assert.equal(calls.some(([action]) => action === "complete"), true);
});

test("an empty queue does not request Storage deletion", async () => {
  const { dependencies, calls } = createDependencies([]);

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(result.claimed, 0);
  assert.equal(result.completed, 0);
  assert.equal(calls.some(([action]) => action === "remove"), false);
});

test("Storage failures are recorded for retry", async () => {
  const { dependencies, calls } = createDependencies(
    [createItem()],
    Object.assign(new Error("Storage unavailable"), { status: 503 }),
  );

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(result.retried, 1);
  assert.equal(result.completed, 0);
  assert.equal(calls.some(([action]) => action === "retry"), true);
});

test("a queue entry cannot delete another user's object", async () => {
  const { dependencies, calls } = createDependencies([
    createItem({ object_path: `${studentId}/other-user.png` }),
  ]);

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(result.blocked, 1);
  assert.equal(calls.some(([action]) => action === "remove"), false);
  assert.equal(calls.some(([action]) => action === "block"), true);
});

test("a queue entry cannot use the other role's bucket", async () => {
  const { dependencies, calls } = createDependencies([
    createItem({ bucket_id: "student-profile-images" }),
  ]);

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(result.blocked, 1);
  assert.equal(calls.some(([action]) => action === "remove"), false);
});

test("a stored URL from another project is blocked", async () => {
  const { dependencies, calls } = createDependencies([
    createItem({ source_origin: "https://different-project.supabase.co" }),
  ]);

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(result.blocked, 1);
  assert.equal(calls.some(([action]) => action === "remove"), false);
});

test("a same-project Storage URL origin is accepted", async () => {
  const { dependencies, calls } = createDependencies([
    createItem({ source_origin: "https://example-project.supabase.co" }),
  ]);

  const result = await processProfilePhotoCleanupBatch(dependencies, supabaseUrl);

  assert.equal(result.completed, 1);
  assert.equal(calls.some(([action]) => action === "remove"), true);
});
