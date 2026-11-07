import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    {"title": "ClinicQ \u00b7 Clinic queue management"},
    {"name": "description", "content": "Manage clinic appointments and patient queues with ClinicQ."},
    {"property": "og:title", "content": "ClinicQ \u00b7 Clinic queue management"},
    {"property": "og:description", "content": "Manage clinic appointments and patient queues with ClinicQ."},
    {"property": "og:type", "content": "website"},
    {"name": "twitter:card", "content": "summary_large_image"},
  ] }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/dashboard" : "/auth" });
  },
  component: () => null,
});
