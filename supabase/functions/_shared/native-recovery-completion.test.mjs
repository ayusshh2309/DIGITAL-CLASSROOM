import assert from "node:assert/strict";
import test from "node:test";
import { finishClaimedNativeRecovery } from "./native-recovery-completion.ts";

const replacementId = "00000000-0000-4000-8000-000000000001";
const oldFactorIds = [
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

function factor(id) {
  return { id, factor_type: "totp", status: "verified" };
}

function dependencies(factors, options = {}) {
  const unenrollCalls = [];
  let finalizeCalls = 0;
  return {
    unenrollCalls,
    get finalizeCalls() {
      return finalizeCalls;
    },
    async listFactors() {
      return { factors: [...factors] };
    },
    async getAssurance() {
      return { currentLevel: "aal2" };
    },
    async unenroll(id) {
      unenrollCalls.push(id);
      if (options.unenroll?.(id, factors)) return { error: new Error("Unenroll failed") };
      const index = factors.findIndex((entry) => entry.id === id);
      if (index < 0) return { error: new Error("Factor already removed") };
      factors.splice(index, 1);
      return { error: null };
    },
    async finalize() {
      finalizeCalls += 1;
      return { completed: true };
    },
  };
}

test("partial factor-removal failure can be retried without repeating completed removals", async () => {
  const factors = [factor(oldFactorIds[0]), factor(oldFactorIds[1]), factor(replacementId)];
  let failSecondRemoval = true;
  const deps = dependencies(factors, {
    unenroll(id) {
      if (id === oldFactorIds[1] && failSecondRemoval) {
        failSecondRemoval = false;
        return true;
      }
      return false;
    },
  });

  const first = await finishClaimedNativeRecovery(oldFactorIds, replacementId, deps);
  assert.equal(first.completed, false);
  assert.equal(first.retryable, true);
  assert.deepEqual(factors.map(({ id }) => id), [oldFactorIds[1], replacementId]);
  assert.equal(deps.finalizeCalls, 0);

  const retry = await finishClaimedNativeRecovery(oldFactorIds, replacementId, deps);
  assert.deepEqual(retry, { completed: true });
  assert.deepEqual(deps.unenrollCalls, [
    oldFactorIds[0],
    oldFactorIds[1],
    oldFactorIds[1],
  ]);
  assert.equal(deps.finalizeCalls, 1);
});

test("concurrent completion retries tolerate a factor removed by the competing request", async () => {
  const factors = [factor(oldFactorIds[0]), factor(replacementId)];
  const deps = dependencies(factors);

  const outcomes = await Promise.all([
    finishClaimedNativeRecovery([oldFactorIds[0]], replacementId, deps),
    finishClaimedNativeRecovery([oldFactorIds[0]], replacementId, deps),
  ]);

  assert.ok(outcomes.every((outcome) => outcome.completed));
  assert.equal(factors.some(({ id }) => id === oldFactorIds[0]), false);
  assert.equal(deps.finalizeCalls, 2);
});

test("finalization is blocked until the replacement remains AAL2-verified and old factors are gone", async () => {
  const factors = [factor(oldFactorIds[0]), factor(replacementId)];
  const deps = dependencies(factors);
  let assuranceCalls = 0;
  deps.getAssurance = async () => ({
    currentLevel: ++assuranceCalls === 1 ? "aal2" : "aal1",
  });

  const result = await finishClaimedNativeRecovery([oldFactorIds[0]], replacementId, deps);

  assert.equal(result.completed, false);
  assert.equal(result.retryable, true);
  assert.equal(deps.finalizeCalls, 0);
  assert.equal(factors.some(({ id }) => id === oldFactorIds[0]), false);
});

test("a missing replacement factor never causes prior-factor removal", async () => {
  const factors = [factor(oldFactorIds[0])];
  const deps = dependencies(factors);

  const result = await finishClaimedNativeRecovery([oldFactorIds[0]], replacementId, deps);

  assert.equal(result.completed, false);
  assert.equal(result.retryable, false);
  assert.deepEqual(deps.unenrollCalls, []);
});
