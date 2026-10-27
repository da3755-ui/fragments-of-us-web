# Putting Fragments of Us online

The site is a small Node server with a SQLite database file. Any host works as long as it gives you **Node 22.5+** and a **persistent disk** (without one, the memory is wiped on every redeploy). Two ready-made routes are below.

## Before you start (5 minutes)

1. **Add your contact address.** Open `public/privacy.html`, search for `[operator contact email]` and replace it with an address visitors can write to. A dedicated address for the project is a good idea.
2. **Put the code on GitHub.** Create a new repository at github.com/new (it can be private), then in this folder:
   ```bash
   git init
   git add .
   git commit -m "Fragments of Us"
   git branch -M main
   git remote add origin https://github.com/<you>/fragments-of-us.git
   git push -u origin main
   ```

## Option A: Render (simplest)

`render.yaml` already describes the whole service: Node 22, a 1 GB disk at `/var/data`, the database on that disk, proxy settings, a health check, and a randomly generated admin token.

1. Sign in at render.com and choose **New → Blueprint**.
2. Connect your GitHub account and pick the `fragments-of-us` repository.
3. Confirm. Render builds it and gives you an address like `https://fragments-of-us.onrender.com`.

A persistent disk needs a paid instance on Render; the free tier has no disk, so the memory would reset. Check Render's current pricing before you confirm.

## Option B: Railway, Fly.io or any container host

The `Dockerfile` builds the site. Whatever host you pick:

- attach a **volume mounted at `/data`** (the database lives at `/data/memory.db`);
- set `ADMIN_TOKEN` to a long random string if you want the moderation tools;
- the app listens on port `3000` (or whatever `PORT` the host sets).

On **Railway**: New Project → Deploy from GitHub repo → then add a Volume to the service with mount path `/data`.

On **Fly.io**: `fly launch` in this folder, then `fly volumes create memory --size 1` and add to `fly.toml`:
```toml
[mounts]
  source = "memory"
  destination = "/data"
```

## After it's live

- Open the site, submit a test message, then erase it with its token.
- **Proxy check:** submissions are unlimited, but erase attempts are limited per visitor. If erasing starts saying "Too many attempts" for everyone at once, the server is seeing the proxy's address instead of visitors'. `TRUST_PROXY=1` (already set in both routes) fixes this on Render, Railway and Fly.
- **Logs:** the app writes no request logs. Your host may keep its own network logs with IP addresses; check its settings or mention it in the privacy policy.
- **Moderation:** with your `ADMIN_TOKEN` (Render shows it under Environment):
  ```bash
  curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-site>/api/admin/messages
  curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-site>/api/admin/messages/12
  ```
- **Backups:** if you turn on disk snapshots, keep them for 30 days at most, as the privacy policy promises.
- **Custom domain:** both Render and Railway let you add your own domain in the service settings.
