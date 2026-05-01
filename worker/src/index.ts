/**
 * ISPC API Worker
 *
 * Public endpoints (origin-locked, no auth):
 *   POST /feedback       — accepts feedback form, creates GitHub Issue
 *   POST /submissions    — accepts story submission, creates GitHub Issue
 *
 * Admin endpoints (Cloudflare Access protects /admin/* — configure in
 *   Zero Trust dashboard with policy: email == iriszimmerfrau@gmail.com):
 *   GET  /admin                              — admin dashboard HTML
 *   GET  /admin/api/feedback                 — list open feedback issues
 *   GET  /admin/api/submissions              — list open submission issues
 *   POST /admin/api/issues/:n/close|approve|reject  — moderate
 */

interface Env {
  GITHUB_TOKEN: string; // secret
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  ALLOWED_ORIGIN: string;
}

const LIMITS = {
  feedback: 4000,
  storyTitle: 200,
  story: 20000,
  category: 32,
  lang: 4,
  pseudonym: 80,
  contact: 200,
  contentWarning: 200,
} as const;

// Control char strip pattern, written via Unicode escapes so the source
// file stays free of literal control bytes.
const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

function corsHeaders(allowedOrigin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, allowedOrigin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(allowedOrigin) },
  });
}

function plain(msg: string, status = 200): Response {
  return new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function sanitize(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CTRL, '').trim().slice(0, max);
}

async function gh(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ispc-api-worker',
      ...(init?.headers ?? {}),
    },
  });
}

async function createIssue(
  env: Env,
  args: { title: string; body: string; labels: string[] },
): Promise<unknown> {
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub createIssue ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  labels: { name: string }[];
}

async function listIssues(env: Env, label: string): Promise<Issue[]> {
  const res = await gh(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?labels=${encodeURIComponent(
      label,
    )}&state=open&per_page=100&sort=created&direction=desc`,
  );
  if (!res.ok) throw new Error(`GitHub listIssues ${res.status}`);
  const data = (await res.json()) as Issue[];
  // Filter out PRs (Issues API returns PRs too)
  return data.filter((it) => !('pull_request' in it));
}

async function patchIssue(
  env: Env,
  num: number,
  args: { state?: 'open' | 'closed'; labels?: string[] },
): Promise<void> {
  const res = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${num}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub patchIssue ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function handleFeedback(req: Request, env: Env, origin: string): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  // Honeypot — should always be empty for humans
  if (typeof data.website === 'string' && data.website.length > 0) {
    return json({ ok: true }, 200, origin); // silently swallow bot
  }
  const message = sanitize(data.message, LIMITS.feedback);
  const category = sanitize(data.category, LIMITS.category);
  const lang = sanitize(data.lang, LIMITS.lang);

  if (!message || message.length < 3) return json({ error: 'message_required' }, 400, origin);

  const body = [
    `**Category:** ${category || 'general'}`,
    `**Language:** ${lang || 'unknown'}`,
    '',
    '---',
    '',
    message,
  ].join('\n');

  await createIssue(env, {
    title: `Feedback (${category || 'general'})`,
    body,
    labels: ['feedback'],
  });
  return json({ ok: true }, 200, origin);
}

async function handleSubmission(req: Request, env: Env, origin: string): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  if (typeof data.website === 'string' && data.website.length > 0) {
    return json({ ok: true }, 200, origin);
  }
  const title = sanitize(data.title, LIMITS.storyTitle);
  const story = sanitize(data.story, LIMITS.story);
  const lang = sanitize(data.lang, LIMITS.lang);
  const pseudonym = sanitize(data.pseudonym, LIMITS.pseudonym);
  const contentWarning = sanitize(data.contentWarning, LIMITS.contentWarning);
  const contact = sanitize(data.contact, LIMITS.contact);

  if (!title || title.length < 3) return json({ error: 'title_required' }, 400, origin);
  if (!story || story.length < 50) return json({ error: 'story_too_short' }, 400, origin);

  const body = [
    `**Language:** ${lang || 'unknown'}`,
    `**Pseudonym:** ${pseudonym || 'Anonymous'}`,
    `**Content warning:** ${contentWarning || 'none'}`,
    `**Contact (optional):** ${contact || '—'}`,
    '',
    '---',
    '',
    story,
  ].join('\n');

  await createIssue(env, {
    title: `Story submission: ${title}`,
    body,
    labels: ['submission'],
  });
  return json({ ok: true }, 200, origin);
}

const ADMIN_MOD_RE = /^\/admin\/api\/issues\/(\d+)\/(close|approve|reject)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const allowedOrigin = env.ALLOWED_ORIGIN;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    // Lock public form POSTs to our origin
    if (req.method === 'POST' && (url.pathname === '/feedback' || url.pathname === '/submissions')) {
      const origin = req.headers.get('Origin');
      if (origin !== allowedOrigin) {
        return json({ error: 'forbidden_origin' }, 403, allowedOrigin);
      }
    }

    try {
      // Public endpoints
      if (req.method === 'POST' && url.pathname === '/feedback') {
        return await handleFeedback(req, env, allowedOrigin);
      }
      if (req.method === 'POST' && url.pathname === '/submissions') {
        return await handleSubmission(req, env, allowedOrigin);
      }

      // Admin endpoints — Cloudflare Access protects /admin/* at the edge,
      // BEFORE this Worker runs. Code here trusts that gate.
      if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
        return new Response(adminHtml(), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      if (req.method === 'GET' && url.pathname === '/admin/api/feedback') {
        const issues = await listIssues(env, 'feedback');
        return json({ issues }, 200, allowedOrigin);
      }
      if (req.method === 'GET' && url.pathname === '/admin/api/submissions') {
        const issues = await listIssues(env, 'submission');
        return json({ issues }, 200, allowedOrigin);
      }
      if (req.method === 'POST') {
        const m = ADMIN_MOD_RE.exec(url.pathname);
        if (m) {
          const num = parseInt(m[1], 10);
          const action = m[2];
          if (action === 'close') {
            await patchIssue(env, num, { state: 'closed' });
          } else if (action === 'approve') {
            await patchIssue(env, num, { state: 'closed', labels: ['submission', 'approved'] });
          } else if (action === 'reject') {
            await patchIssue(env, num, { state: 'closed', labels: ['submission', 'rejected'] });
          }
          return json({ ok: true }, 200, allowedOrigin);
        }
      }

      // Health check (handy for verifying the route works end-to-end)
      if (req.method === 'GET' && url.pathname === '/health') {
        return plain('ok');
      }

      return plain('not found', 404);
    } catch (err) {
      console.error('worker error', err);
      return json({ error: 'internal_error' }, 500, allowedOrigin);
    }
  },
};

/** Admin dashboard HTML — served by Worker, behind Cloudflare Access. */
function adminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>ISPC Admin</title>
<style>
:root { --bg:#faf7f2; --navy:#0d1b2e; --terra:#b85c38; --olive:#5a6e48; --red:#c4382b; --muted:#5a5750; --cream:#f0e6d3; }
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:#1a1a18;line-height:1.5}
header{background:var(--navy);color:var(--cream);padding:.85rem 1.25rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
header h1{margin:0;font-size:.95rem;font-weight:600;letter-spacing:.02em}
header .who{font-size:.78rem;opacity:.7;margin-right:1rem}
header a.logout{color:var(--cream);font-size:.78rem;opacity:.7;text-decoration:underline}
header a.logout:hover{opacity:1}
main{max-width:980px;margin:0 auto;padding:1.25rem}
.tabs{display:flex;gap:0;border-bottom:1px solid #d8cfb9;margin-bottom:1.25rem}
.tabs button{background:none;border:none;padding:.7rem 1.15rem;cursor:pointer;font:inherit;color:var(--muted);border-bottom:2px solid transparent}
.tabs button[aria-selected="true"]{color:var(--navy);border-bottom-color:var(--terra);font-weight:600}
.tabs .count{display:inline-block;margin-inline-start:.4rem;font-size:.7rem;background:var(--terra);color:white;padding:.05rem .4rem;border-radius:99px;vertical-align:middle}
.panel{display:none}
.panel[data-active]{display:block}
.item{background:white;border:1px solid #e5dcc6;padding:1rem;margin-bottom:.75rem}
.item h3{margin:0 0 .35rem;font-size:.95rem;color:var(--navy)}
.item .meta{font-size:.72rem;color:var(--muted);margin-bottom:.5rem;font-family:ui-monospace,monospace}
.item .body{white-space:pre-wrap;font-size:.85rem;max-height:340px;overflow-y:auto;padding:.65rem;background:#faf7f2;border:1px solid #ece4d3;font-family:ui-monospace,Menlo,monospace}
.actions{margin-top:.7rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.actions button,.actions a{padding:.4rem .8rem;font-size:.8rem;cursor:pointer;border:1px solid var(--navy);background:white;color:var(--navy);text-decoration:none;font-family:inherit}
.actions button.approve{background:var(--olive);color:white;border-color:var(--olive)}
.actions button.reject{background:var(--red);color:white;border-color:var(--red)}
.actions a.gh{color:var(--muted);border-color:#ddd;font-size:.75rem}
.empty{padding:2rem;text-align:center;color:var(--muted)}
.err{color:var(--red);padding:1rem;background:#fff;border:1px solid var(--red)}
.toast{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:var(--navy);color:white;padding:.6rem 1rem;font-size:.85rem;z-index:99}
</style>
</head>
<body>
<header>
  <h1>ISPC Admin</h1>
  <div>
    <span class="who" id="who"></span>
    <a class="logout" href="/cdn-cgi/access/logout">Sign out</a>
  </div>
</header>
<main>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-tab="submissions">Submissions <span class="count" id="count-sub">0</span></button>
    <button role="tab" aria-selected="false" data-tab="feedback">Feedback <span class="count" id="count-fb">0</span></button>
  </div>
  <section id="panel-submissions" class="panel" data-active>
    <div id="submissions-list" class="empty">Loading…</div>
  </section>
  <section id="panel-feedback" class="panel">
    <div id="feedback-list" class="empty">Loading…</div>
  </section>
</main>
<div id="toast" class="toast" hidden></div>
<script>
(function(){
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function toast(msg){var t=$('toast');t.textContent=msg;t.hidden=false;setTimeout(function(){t.hidden=true},2200)}

  fetch('/cdn-cgi/access/get-identity',{credentials:'include'})
    .then(function(r){return r.ok?r.json():null})
    .then(function(d){if(d&&d.email)$('who').textContent=d.email})
    .catch(function(){});

  function render(container,items,kind){
    if(!items.length){container.innerHTML='<div class="empty">No items.</div>';return}
    container.innerHTML=items.map(function(it){
      var date=new Date(it.created_at).toLocaleString();
      var actions = kind==='submissions'
        ? '<button class="approve" data-act="approve" data-id="'+it.number+'">Approve</button>'
          +'<button class="reject" data-act="reject" data-id="'+it.number+'">Reject</button>'
          +'<a class="gh" href="'+esc(it.html_url)+'" target="_blank" rel="noopener noreferrer">Open in GitHub</a>'
        : '<button data-act="close" data-id="'+it.number+'">Mark resolved</button>'
          +'<a class="gh" href="'+esc(it.html_url)+'" target="_blank" rel="noopener noreferrer">Open in GitHub</a>';
      return '<article class="item">'
        +'<h3>#'+it.number+' '+esc(it.title)+'</h3>'
        +'<div class="meta">'+date+'</div>'
        +'<div class="body">'+esc(it.body||'')+'</div>'
        +'<div class="actions">'+actions+'</div>'
        +'</article>';
    }).join('');
    container.querySelectorAll('button[data-act]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var act=btn.getAttribute('data-act');
        var id=btn.getAttribute('data-id');
        if(!confirm('Confirm '+act+' on #'+id+'?')) return;
        btn.disabled=true;
        fetch('/admin/api/issues/'+id+'/'+act,{method:'POST',credentials:'include'})
          .then(function(r){if(!r.ok)throw 0;toast('Done.');load()})
          .catch(function(){btn.disabled=false;alert('Failed.')});
      });
    });
  }
  function load(){
    fetch('/admin/api/submissions',{credentials:'include'}).then(function(r){return r.json()})
      .then(function(d){var items=d.issues||[];$('count-sub').textContent=items.length;render($('submissions-list'),items,'submissions')})
      .catch(function(){$('submissions-list').innerHTML='<div class="err">Failed to load submissions.</div>'});
    fetch('/admin/api/feedback',{credentials:'include'}).then(function(r){return r.json()})
      .then(function(d){var items=d.issues||[];$('count-fb').textContent=items.length;render($('feedback-list'),items,'feedback')})
      .catch(function(){$('feedback-list').innerHTML='<div class="err">Failed to load feedback.</div>'});
  }
  document.querySelectorAll('.tabs button').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.tabs button').forEach(function(b){b.setAttribute('aria-selected','false')});
      btn.setAttribute('aria-selected','true');
      var name=btn.getAttribute('data-tab');
      document.querySelectorAll('.panel').forEach(function(p){p.removeAttribute('data-active')});
      $('panel-'+name).setAttribute('data-active','');
    });
  });
  load();
})();
</script>
</body>
</html>`;
}
