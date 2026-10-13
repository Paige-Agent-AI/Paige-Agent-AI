# Put a Paige form on a website built with Genspark or hosted on Cloudflare

For the owner and anyone installing a Paige lead form on a site Paige didn't build (Experience 03, S2a).
A site built by a Genspark agent and served from Cloudflare Pages or Workers takes the same code as any other
website. Nothing moves to Paige, nothing is rebuilt in Vibe Studio, and **no Cloudflare account, token or setting
is connected to Paige.**

Answers go from the form straight into Paige: filed for the business, credited to the campaign the visitor came
from, and routed into the campaign's pipeline, exactly as on the form's own page.

What was tested, and how, is at the end of this guide.

---

## 1. Get the code

In Vibe Studio, open the form, publish it, and under **Put it on your website** press **Copy code**. It is one line:

```html
<script src="https://paigeagent.ai/embed.js" data-form="YOUR-FORM-ID" data-title="Your form's name" data-cfasync="false" async></script>
```

- Copy it from Studio rather than typing it: the form id is specific to this form.
- `data-cfasync="false"` is deliberate. It tells Cloudflare's Rocket Loader to leave the tag alone. Keep it.

## 2. Put it on the page

Paste the line **inside the page's `<body>`, at the spot where the form should appear** (for example inside the
contact section). It fits the width it's given and grows to the form's height.

If it ends up in `<head>` instead, the form still shows, but at the bottom of the page.

### If a Genspark agent maintains the site

Give the agent this instruction, with your copied line in place of the example:

```text
Add this code to the contact section of the page, exactly as written, inside the <body>, where the form should
appear. Do not change, wrap, re-format, defer or move it, and do not add a sandbox or another iframe around it.
Keep the attribute data-cfasync="false". If the site sets a Content-Security-Policy, allow https://paigeagent.ai
in script-src and frame-src.

<script src="https://paigeagent.ai/embed.js" data-form="YOUR-FORM-ID" data-title="Your form's name" data-cfasync="false" async></script>
```

### If you edit the HTML yourself

Open the page's `.html` file, paste the line where the form should go, then deploy as you normally do: push to the
connected Git repository, or upload again with Direct Upload or `wrangler pages deploy`. Nothing else changes in
Cloudflare.

## 3. If the site sets a security policy (`_headers`)

Most Genspark sites set no policy, so skip this unless your site has a `_headers` file with a
`Content-Security-Policy` line. If it does, add Paige to two directives, keeping everything else:

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://paigeagent.ai; frame-src https://paigeagent.ai; style-src 'self' 'unsafe-inline'
```

- **Frames allowed, but outside scripts not:** the form can't run as the one-line code. Use the no-script version
  in section 4.
- **Script allowed, but framing Paige blocked:** visitors see an **Open the form** button that opens the form on
  its own page, and the browser console names the directive to add. Add `https://paigeagent.ai` to `frame-src` to
  show the form in place.

## 4. If the site won't run a script tag

Some page builders strip `<script>` tags. In Studio, under the code, press **Get a version without a script**, and
paste that instead:

```html
<iframe src="https://paigeagent.ai/form/YOUR-FORM-ID?embed=1" title="Your form's name" loading="lazy" style="width:100%;height:720px;border:0;color-scheme:normal"></iframe>
```

It works anywhere frames are allowed, with two limits:

- it keeps a fixed height (720px) instead of growing to fit the form;
- it doesn't pass the visit's campaign tags (`utm_*`, `gclid`, `fbclid`) to the form.

Use the one-line code wherever the site allows it.

## 5. If you paste it into a builder's "custom HTML" block

Some builders run custom HTML in a sandbox. If that sandbox doesn't allow same-origin, a form inside it couldn't
send its answers. Visitors there get an **Open the form** button that opens the form on its own page, and the
console says why.

To show the form in place, do one of these:

- paste the code directly into the page instead of the block; or
- turn on the block's "allow same origin" option, if it has one.

## 6. Check it works

1. Open the published page **from a tagged link**, for example `https://your-site.example/?utm_source=test&utm_campaign=<your campaign's reference>`.
2. The form shows where you pasted the code, with no inner scrollbar.
3. Fill it in with test details and send it. The thank-you message shows, or your thank-you page opens if the form
   has one.
4. In Paige, the answer appears under the form's submissions, credited to that campaign, and the lead is in the
   campaign's pipeline.

If the form says **"This form isn't available right now,"** it isn't published. Publish it in Studio.

## What Paige does and doesn't do on your site

| | |
|---|---|
| Answers | Sent from Paige's own address (`paigeagent.ai`), never from your site's code. Your site never handles them. |
| Your page's other links | Only `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid` and `fbclid` travel to the form. Nothing else from your page's address does. |
| Paige's own analytics | Off inside a form on your site. Your visitors aren't tracked by Paige's product analytics there. |
| Look | Light by default. Add `data-theme="dark"` (or `"auto"`, which follows the visitor's setting) to the tag. Your page shows around the card. |
| Cloudflare account | Not needed, not asked for, not connected. |

## How this was tested

`scripts/live-drive/cloudflare-embed-drive.mjs` serves a Genspark-style static site on **Cloudflare's own Pages
runtime** (`wrangler pages dev`, which applies the site's `_headers` the way Pages does). The real Paige app runs on
another origin, and a browser drives every case above. Supabase is stubbed at the network, so nothing reaches
production.

| Case | Result |
|---|---|
| Plain page, desktop | The form works end to end |
| Plain page, phone width (390px) | The form works end to end |
| Code pasted into `<head>` | The form shows at the end of the page and works |
| Rocket Loader on, copied tag | Exactly one form, in place, works |
| Rocket Loader on, older tag without `data-cfasync` | Exactly one form, in place, works |
| CSP allowing Paige | The form works end to end |
| CSP blocking the frame | Link to the form instead, and a console message naming the fix |
| CSP blocking outside scripts | The tag can't run; the no-script version works end to end |
| Builder block sandboxed without same-origin, one-line code | Link to the form instead; nothing sent |
| Builder block sandboxed without same-origin, no-script version | "This form opens on its own page", with a link |
| Builder block sandboxed with same-origin | The form works end to end |
| Thank-you redirect | Your thank-you page replaces the visitor's page |
| Paige's own analytics inside the form on your site | None |
| Paige's own analytics on the form's own page | Unchanged |

`scripts/live-drive/form-embed-intake-replay.sh` then takes an answer the browser actually sent and files it through
the real intake rules into the real database (a rolled-back local clone). That answer is filed for the form's
business, credited to its campaign, and put in the campaign's pipeline.

**Not tested here:**

- Cloudflare's live edge. Rocket Loader is Cloudflare's own script, but the harness applies it to the page.
- A real Genspark-generated site.
- A signed-in production run. That is coordinated by the QA coordinator on the designated test account.
- Sites that send `Cross-Origin-Embedder-Policy: require-corp`. Paige's form page doesn't opt in to being embedded
  under it, so such a site would likely block the frame.
