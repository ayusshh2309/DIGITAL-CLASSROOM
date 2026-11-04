type RecoveryFactor = {
  id: string;
  factor_type: string;
  status: string;
};

type FactorListResult = {
  factors: RecoveryFactor[];
  error?: unknown;
};

type AssuranceResult = {
  currentLevel: string | null;
  error?: unknown;
};

type CompletionResult = {
  completed: boolean;
  error?: unknown;
};

type CompletionDependencies = {
  listFactors(): Promise<FactorListResult>;
  getAssurance(): Promise<AssuranceResult>;
  unenroll(factorId: string): Promise<{ error?: unknown }>;
  finalize(): Promise<CompletionResult>;
};

export type NativeRecoveryCompletionResult =
  | { completed: true }
  | { completed: false; retryable: boolean; message: string };

export async function finishClaimedNativeRecovery(
  priorFactorIds: string[],
  replacementFactorId: string,
  dependencies: CompletionDependencies,
): Promise<NativeRecoveryCompletionResult> {
  if (!priorFactorIds.length || priorFactorIds.includes(replacementFactorId)) {
    return {
      completed: false,
      retryable: false,
      message: "The claimed recovery transaction has an invalid factor list.",
    };
  }

  const [{ factors: initialFactors, error: initialFactorsError },
    { currentLevel: initialLevel, error: initialAssuranceError }] = await Promise.all([
      dependencies.listFactors(),
      dependencies.getAssurance(),
    ]);
  if (initialFactorsError || initialAssuranceError) {
    return {
      completed: false,
      retryable: true,
      message: "Recovery completion is claimed. Could not confirm the replacement authenticator; retry completion.",
    };
  }
  if (initialLevel !== "aal2" ||
    !initialFactors.some((factor) =>
      factor.id === replacementFactorId &&
      factor.factor_type === "totp" &&
      factor.status === "verified"
    )) {
    return {
      completed: false,
      retryable: false,
      message: "The replacement authenticator must be verified at AAL2 before old authenticators can be removed.",
    };
  }

  for (const oldFactorId of priorFactorIds) {
    const { factors, error: listError } = await dependencies.listFactors();
    if (listError) {
      return {
        completed: false,
        retryable: true,
        message: "Recovery completion is claimed. Could not check old authenticators; retry completion.",
      };
    }

    const oldFactor = factors.find((factor) => factor.id === oldFactorId);
    if (!oldFactor) continue;
    if (oldFactor.factor_type !== "totp" || oldFactor.status !== "verified") {
      return {
        completed: false,
        retryable: false,
        message: "Recovery completion is claimed, but an original authenticator has an unexpected state. Contact support.",
      };
    }

    const { error: unenrollError } = await dependencies.unenroll(oldFactorId);
    if (!unenrollError) continue;

    const { factors: retryFactors, error: retryListError } =
      await dependencies.listFactors();
    if (retryListError) {
      return {
        completed: false,
        retryable: true,
        message: "Recovery completion is claimed. Could not confirm whether an old authenticator was removed; retry completion.",
      };
    }
    if (retryFactors.some((factor) => factor.id === oldFactorId)) {
      return {
        completed: false,
        retryable: true,
        message: "The replacement authenticator is verified, but an old authenticator could not be removed. Retry recovery completion.",
      };
    }
  }

  const [{ factors, error: factorsError }, { currentLevel, error: assuranceError }] =
    await Promise.all([
      dependencies.listFactors(),
      dependencies.getAssurance(),
    ]);
  if (factorsError || assuranceError) {
    return {
      completed: false,
      retryable: true,
      message: "Could not confirm the replacement authenticator after removing old factors. Retry recovery completion.",
    };
  }

  if (currentLevel !== "aal2" ||
    !factors.some((factor) =>
      factor.id === replacementFactorId &&
      factor.factor_type === "totp" &&
      factor.status === "verified"
    ) ||
    priorFactorIds.some((factorId) => factors.some((factor) => factor.id === factorId))) {
    return {
      completed: false,
      retryable: true,
      message: "The replacement authenticator must remain verified at AAL2 and all old authenticators must be removed. Retry recovery completion.",
    };
  }

  const { completed, error } = await dependencies.finalize();
  if (error || !completed) {
    return {
      completed: false,
      retryable: true,
      message: "Recovery is claimed but could not be finalized. Retry completion.",
    };
  }
  return { completed: true };
}
