import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const teacherDataSource = await readFile(
  fileURLToPath(new URL("./teacher-data.js", import.meta.url)),
  "utf8",
);

const user = {
  id: "teacher-user-id",
  email: "confirmed@example.com",
};

function createTeacherData({ teacherEmail, updateError = null }) {
  const profile = {
    id: "teacher-row-id",
    user_id: user.id,
    email: teacherEmail,
    full_name: "Teacher Name",
  };
  const calls = [];
  const client = {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      },
    },
    from(table) {
      let operation = "select";
      let updates = null;
      const filters = {};
      const query = {
        select() {
          if (operation !== "update") operation = "select";
          return query;
        },
        eq(column, value) {
          filters[column] = value;
          return query;
        },
        update(values) {
          operation = "update";
          updates = values;
          return query;
        },
        async maybeSingle() {
          if (table !== "teachers" || filters.user_id !== user.id) {
            throw new Error("Unexpected teacher profile lookup.");
          }
          calls.push({ operation, filters: { ...filters } });
          return { data: profile, error: null };
        },
        async single() {
          calls.push({
            operation,
            filters: { ...filters },
            updates,
          });
          if (updateError) return { data: null, error: updateError };
          return {
            data: {
              ...profile,
              ...updates,
            },
            error: null,
          };
        },
      };
      return query;
    },
  };
  const window = {
    SmartLearningSupabase: {
      isConfigured: () => true,
      getClient: () => client,
    },
  };

  runInNewContext(teacherDataSource, {
    window,
    console,
    URL,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });

  return { TeacherData: window.TeacherData, calls };
}

test("settings load synchronizes confirmed Auth email to only the matching Teacher row", async () => {
  const { TeacherData, calls } = createTeacherData({
    teacherEmail: "old@example.com",
  });

  const updated = await TeacherData.syncCurrentTeacherEmail();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, "select");
  assert.equal(calls[1].operation, "update");
  assert.equal(calls[1].filters.id, "teacher-row-id");
  assert.equal(calls[1].filters.user_id, user.id);
  assert.equal(calls[1].updates.email, user.email);
  assert.equal(updated.id, "teacher-row-id");
  assert.equal(updated.user_id, user.id);
  assert.equal(updated.email, user.email);
});

test("settings load does not write when Teacher and Auth emails already match", async () => {
  const { TeacherData, calls } = createTeacherData({
    teacherEmail: user.email,
  });

  const profile = await TeacherData.syncCurrentTeacherEmail();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, "select");
  assert.equal(profile.email, user.email);
});

test("email synchronization surfaces database errors", async () => {
  const databaseError = Object.assign(new Error("RLS denied update"), {
    code: "42501",
  });
  const { TeacherData } = createTeacherData({
    teacherEmail: "old@example.com",
    updateError: databaseError,
  });

  await assert.rejects(
    TeacherData.syncCurrentTeacherEmail(),
    { code: "42501" },
  );
});
