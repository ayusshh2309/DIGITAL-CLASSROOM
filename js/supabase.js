// No-op stubs for auth and data access.
export const supabase = null;

const noopError = { message: 'Integration disabled' };

export const learnerSignUp = async (form) => ({ data: null, error: noopError });
export const teacherSignUp = async (...args) => ({ data: null, error: noopError });
export const loginUser = async () => ({ data: null, error: noopError });
export const forgotPassword = async () => ({ data: null, error: noopError });
export const resetPassword = async () => ({ data: null, error: noopError });
export const logoutUser = async () => ({ error: noopError });
export const getCurrentUser = async () => null;
export const googleLogin = async () => { console.warn('googleLogin called but integration is disabled'); };
export const microsoftLogin = async () => { console.warn('microsoftLogin called but integration is disabled'); };