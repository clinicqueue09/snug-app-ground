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
- Address the AWS WhatsApp gateway via `http://15.207.87.63.nip.io:3000` (hostname alias), never a bare IP in fetch URLs — the edge/worker runtime blocks direct-IP fetches with Cloudflare "error code: 1003"; `gatewayFetch()` in `src/lib/whatsapp.functions.ts` falls back to the raw IP for Node/dev.
