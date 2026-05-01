# ISPC API Worker

Cloudflare Worker that backs the public feedback / story-submission forms and the admin dashboard. Storage is GitHub Issues in a private inbox repo. Admin is protected by Cloudflare Access.

## Endpoints

| Method | Path                                    | Auth          | Purpose                              |
| ------ | --------------------------------------- | ------------- | ------------------------------------ |
| POST   | `/feedback`                             | Origin lock   | Create feedback Issue                |
| POST   | `/submissions`                          | Origin lock   | Create story submission Issue        |
| GET    | `/admin`                                | CF Access     | Admin dashboard HTML                 |
| GET    | `/admin/api/feedback`                   | CF Access     | List open feedback                   |
| GET    | `/admin/api/submissions`                | CF Access     | List open submissions                |
| POST   | `/admin/api/issues/:n/(close│approve│reject)` | CF Access | Moderate                          |
| GET    | `/health`                               | None          | Worker health check                  |

## One-time deploy

```bash
cd worker
pnpm install
pnpm wrangler login                                 # OAuth flow in browser
pnpm wrangler whoami                                # copy your account ID into wrangler.toml
pnpm wrangler secret put GITHUB_TOKEN               # paste your fine-grained PAT
pnpm wrangler deploy
```

After the first deploy:

```bash
curl https://api.ispc-iq.org/health  # → ok
```

## Cloudflare Access setup (one-time)

In the Zero Trust dashboard → Access → Applications → Add → **Self-hosted**:

- Application name: `ISPC Admin`
- Session duration: `24 hours`
- Application domain: `api.ispc-iq.org`, Path: `admin/*`
- Identity providers: enable **One-time PIN**
- Policy: Allow → Include → Emails → `iriszimmerfrau@gmail.com`

After saving, hitting `https://api.ispc-iq.org/admin` will require an emailed code before the Worker is reached.

## Updating

```bash
cd worker
pnpm wrangler deploy
```

## Tail logs (no PII; line-buffered fetch errors only)

```bash
pnpm wrangler tail
```

## Rotating the GitHub PAT

```bash
pnpm wrangler secret put GITHUB_TOKEN
```
