# Backend setup: Cloudflare Worker + GitHub Issues + Cloudflare Access

This document covers the one-time setup for the feedback form, story submission form, and admin dashboard. The static site stays on GitHub Pages; the form-handling backend runs on a Cloudflare Worker at `api.ispc-iq.org`. Storage is GitHub Issues in a private inbox repo. Admin auth is Cloudflare Access (magic-link to your email).

## Why this stack

- **No third-party form service.** Cloudflare Workers run on infrastructure you control via free-tier account. No Formspree, no Tally, no Google Forms.
- **No database to manage.** Submissions are GitHub Issues — version-controlled, free, with email notifications and a UI you already know.
- **No password to leak.** Cloudflare Access uses one-time email codes — no admin password, no session DB.
- **No PII collection.** The Worker doesn't log IPs. Cloudflare's edge logs are line-buffered fetch metadata only and not retained for analytics.

## Prerequisites

- Cloudflare account (free)
- Namecheap domain (`ispc-iq.org`) — staying with Namecheap, only `api.` subdomain is delegated
- GitHub account: `iriszimmerfrau-collab`

---

## Step 1 — Delegate `api.ispc-iq.org` to Cloudflare

1. Cloudflare dashboard → **Add a site** → enter exactly `api.ispc-iq.org` → Free plan.
2. Cloudflare gives you 2 nameservers like `clay.ns.cloudflare.com`, `kim.ns.cloudflare.com`. Copy them.
3. Namecheap → Domain List → Manage `ispc-iq.org` → **Advanced DNS** tab → Add 2 records:

   | Type | Host | Value | TTL |
   |---|---|---|---|
   | NS Record | `api` | `<cloudflare-ns-1>` | Automatic |
   | NS Record | `api` | `<cloudflare-ns-2>` | Automatic |

4. Save. Wait 5–30 min for propagation. Cloudflare will mark the zone "Active" once it sees the NS records.

Verify with:

```bash
dig NS api.ispc-iq.org +short
```

Should print the two Cloudflare nameservers.

---

## Step 2 — Create the private inbox repo

1. https://github.com/new
2. Name: `ispc-inbox`
3. Visibility: **Private**
4. Don't initialize with README.
5. Create.
6. In the new repo: Issues → Labels → **New label**, create three labels:
   - `feedback`
   - `submission`
   - `approved`

(The Worker will automatically apply `feedback` or `submission` when issues are created. `approved` is set by you when you approve a story.)

---

## Step 3 — Create a GitHub fine-grained PAT for the Worker

1. GitHub → click your avatar → **Settings** → Developer settings → Personal access tokens → **Fine-grained tokens** → **Generate new token**.
2. Token name: `ISPC Worker`
3. Expiration: 1 year (calendar a renewal)
4. Repository access: **Only select repositories** → `iriszimmerfrau-collab/ispc-inbox`
5. Repository permissions:
   - **Issues**: Read and write
   - **Metadata**: Read-only (auto-required)
6. Generate token. Copy the `github_pat_...` value once. You'll paste it into Wrangler in Step 4.

---

## Step 4 — Deploy the Worker

```bash
cd worker
pnpm install
pnpm wrangler login                              # opens browser for OAuth
pnpm wrangler whoami                             # copy your account ID
```

Open `worker/wrangler.toml`, replace `REPLACE_WITH_YOUR_ACCOUNT_ID` with your Cloudflare account ID.

```bash
pnpm wrangler secret put GITHUB_TOKEN            # paste the github_pat_... value
pnpm wrangler deploy
```

Verify:

```bash
curl https://api.ispc-iq.org/health
# → ok
```

---

## Step 5 — Configure Cloudflare Access (admin auth)

1. Cloudflare dashboard → top-right account menu → **Zero Trust**.
2. Access → **Applications** → **Add an application** → **Self-hosted**.
3. Configure:
   - Application name: `ISPC Admin`
   - Session duration: `24 hours`
   - **Application domain**: subdomain `api`, domain `ispc-iq.org`, path `admin/*`
4. **Identity providers**: keep **One-time PIN** enabled. (No Google/Microsoft account needed — visitors get a 6-digit code emailed to them.)
5. Next → **Add policy**:
   - Policy name: `Admin only`
   - Action: Allow
   - Configure rules → Include → **Emails** → `iriszimmerfrau@gmail.com`
6. Next → save.

Test:

1. Open `https://api.ispc-iq.org/admin` in a private window.
2. You'll see Cloudflare Access prompt for your email.
3. Enter `iriszimmerfrau@gmail.com`. A 6-digit code arrives by email.
4. Enter the code. Admin dashboard loads.

---

## Step 6 — Test the public forms

1. Visit `https://ispc-iq.org/en/feedback`. Submit a test message. You should see "Thank you. We received your message."
2. Check `https://github.com/iriszimmerfrau-collab/ispc-inbox/issues` — a new feedback issue should appear.
3. Reload the admin dashboard at `https://api.ispc-iq.org/admin`. The test feedback should appear under the **Feedback** tab.

---

## Operational notes

### Approving a story

When you approve a story in the admin dashboard:
1. The Worker labels the issue `approved` and closes it.
2. **You then manually publish** by creating a new markdown file in `src/content/stories/{en,ar}/<slug>.md` with the story content, and pushing.
3. The static rebuild publishes the story.

Why manual publish: keeps the public site fully static (no Firestore, no client fetch). The admin queue is separate from the live site.

### Rotating the GitHub PAT

```bash
cd worker
pnpm wrangler secret put GITHUB_TOKEN
pnpm wrangler deploy   # not required, but safe to redeploy
```

### Tail Worker logs

```bash
cd worker
pnpm wrangler tail
```

Logs show fetch errors only (no IPs, no request bodies).

### What gets logged where

| Surface | What's logged | Retention |
|---|---|---|
| Cloudflare edge | request metadata for billing | per Cloudflare's Free-tier policy |
| Worker `console.error` | only failed paths, no PII | rolling, accessible via `wrangler tail` |
| GitHub Issue | the form content, plus a server timestamp | indefinite (your private repo) |
| Cloudflare Access | login attempts (your own email only) | 30 days, in CF Access logs |

### What is NOT collected

- No IP addresses are sent to GitHub.
- No User-Agent strings are stored in issues.
- No cookies on the public form pages.
- No request fingerprinting.
- The visitor's browser sends their IP to Cloudflare's edge (unavoidable for any web request); Cloudflare honours their stated edge log retention but you can configure additional purging via Workers Logs settings if desired.

---

## Adding new admins

Edit the Cloudflare Access policy:

Zero Trust → Access → Applications → ISPC Admin → Policies → Admin only → add another email under **Include**.

The new admin doesn't need a Cloudflare account — just clicks the magic link.

---

## Tearing it all down

If you ever want to reset:

```bash
cd worker
pnpm wrangler delete         # removes the Worker
```

Then in Cloudflare dashboard: remove the Access application, remove the `api.ispc-iq.org` zone, restore Namecheap NS records to defaults.

GitHub PAT: revoke at Settings → Developer settings → Personal access tokens → ISPC Worker → Revoke.
