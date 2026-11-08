<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Address the AWS WhatsApp gateway via `http://13.204.59.137.nip.io:3000` (hostname alias), never a bare IP in fetch URLs — the edge/worker runtime blocks direct-IP fetches with Cloudflare "error code: 1003"; `gatewayFetch()` in `src/lib/whatsapp.functions.ts` falls back to `13.204.59.137` for Node/dev.
- Scheduled hooks (`/api/public/hooks/*` called by pg_cron) authenticate with the `X-Cron-Secret` header via `verifyCronSecret()` in `src/lib/cron-auth.ts`; the shared secret lives in the RLS-locked `public.platform_secrets` table so both the database cron job and the server route read it — never authenticate these hooks with the publishable key.
- Keep appointment slot calculations in `src/lib/scheduling.ts`, with the picker and doctor-hours editor as focused UI modules, so booking and rescheduling share the same schedule rules.
- Keep clinic-scoped patient recognition and channel selection in `src/lib/notification-routing.ts`, used by the central dispatcher; appointment history and saved successful-send counts provide recognition without fabricating consent records.
- Scope dashboard palette overrides through `.dashboard-theme` and doctor-panel tokens; keep appointment picker containers shrinkable with wrapping time buttons and an internally scrolling date strip to prevent page overflow.
- Keep doctor-delay and evening-reminder rules (IST clock, delta limits, 10-minute notify threshold, daily notify cap, 9 PM window) as pure helpers in `src/lib/doctor-delay.ts` so server code and tests share them.
