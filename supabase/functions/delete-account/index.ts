import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization?.startsWith("Bearer ") || !url || !anonKey || !serviceRoleKey) {
    return Response.json({ error: "Account deletion is not configured." }, { status: 500, headers: corsHeaders });
  }

  let body: { confirmation?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: corsHeaders });
  }
  if (body.confirmation !== "DELETE MY ACCOUNT") {
    return Response.json({ error: "Confirmation is required." }, { status: 400, headers: corsHeaders });
  }

  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return Response.json({ error: "Your session is invalid or expired." }, { status: 401, headers: corsHeaders });
  }

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: teacher } = await adminClient
    .from("teachers")
    .select("profile_photo_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return Response.json({ error: "The account could not be deleted. Related records may require cleanup." }, { status: 409, headers: corsHeaders });
  }

  const photoPath = teacher?.profile_photo_url;
  if (photoPath && !photoPath.startsWith("http")) {
    await adminClient.storage.from("teacher-profile-images").remove([photoPath]);
  }

  return Response.json({ deleted: true }, { status: 200, headers: corsHeaders });
});
