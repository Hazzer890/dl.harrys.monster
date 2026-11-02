# dl.harrys.monster

Paste a video link, get an MP3 or MP4 (yt-dlp). Or upload a video file, get an MP3 (ffmpeg). One Bun file, no dependencies.

Run locally: `bun server.ts` (needs `yt-dlp` and `ffmpeg` on PATH), then open http://localhost:3000.

Deploy (waypoint VPS, same as mahjong):

    rsync -a --exclude node_modules --exclude secrets ./ root@167.233.225.99:/root/dl/
    ssh root@167.233.225.99 'cd /root/dl && docker compose up -d --build'

Then add `dl.harrys.monster { reverse_proxy dl:3000 }` to `/root/waypoint/ops/Caddyfile` and restart caddy (`docker compose restart caddy` from `/root/waypoint`), plus a DNS record pointing at the VPS.

YouTube breaks old yt-dlp versions often, so the server runs `yt-dlp -U` at boot and once a day. YouTube blocks the Hetzner IP ("Sign in to confirm you're not a bot"), so YouTube needs cookies from a burner Google account (never your real one; YouTube may ban it):

1. Open a private window, sign in to the burner account, go to `https://www.youtube.com/robots.txt`.
2. Export cookies for youtube.com in Netscape format (e.g. the "Get cookies.txt LOCALLY" extension), then close the private window without signing out so the session isn't rotated.
3. `scp cookies.txt root@167.233.225.99:/root/dl/secrets/cookies.txt`. No restart needed; the server picks it up on the next job.

When the bot error comes back, the cookies have expired: repeat the steps. Locally, without `/secrets/cookies.txt`, yt-dlp runs without cookies.

Limits: 3 jobs at once, 1 GB per video, 60 minutes per job, 50 videos per playlist (zipped). A watch link inside a playlist downloads just that video. Progress is polled from `/api/jobs/:id`; uncollected files are dropped after ~70 minutes.
