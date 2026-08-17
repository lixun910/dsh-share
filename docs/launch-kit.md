# dsh-share launch kit

Six pieces of launch content — Show HN, Product Hunt, Reddit, X, GitHub, and a
demo-video script — each with the angle, the copy, and where it goes.

---

## 01 · Show HN

**Where:** news.ycombinator.com → submit (text submission, repo URL in first comment)
**Angle:** the "written by DeepSeek v4 Flash" line is the hook — HN loves a meta story.

**Title**

```
Show HN: dsh-share — your DeepSeek Harness workspace on your phone, no account
```

**First comment**

```
I built dsh-share because reaching my DeepSeek Harness (dsh) workspace from another device was a chore.

dsh web only trusts loopback by default. To open it from a phone or iPad you have to pass the current tunnel domain as --trusted-host — and the free-tier domain rotates on every restart. No auth on the tunnel either. So every session was: start a tunnel, copy the domain, restart dsh with the flag, and hope nothing changed.

dsh-share automates the whole dance:
- Starts a Cloudflare quick tunnel (no account, no token, no signup)
- Puts a local basic-auth proxy in front of dsh (quick tunnels don't provide auth)
- Starts dsh web with the public URL as --trusted-host
- Shows the URL, credentials, and a QR code in a control window

Scan the QR with your phone camera and the workspace opens in the browser. The dsh-mobile app can also exchange a token embedded in the URL for the live credentials.

The meta part: the entire app was written by DeepSeek v4 Flash. I described the architecture, it wrote the code, I reviewed it. MIT licensed.

It also updates itself: a daily GitHub Action checks for new @deepseek-ai/dsh releases, bumps the bundled harness, builds all three platforms, cuts a release, and the installed app auto-updates via electron-updater. No manual steps.

Downloads: https://github.com/lixun910/dsh-share/releases
Landing page: https://lixun910.github.io/dsh-share/
Source: https://github.com/lixun910/dsh-share

Security note: this exposes your machine to anyone with the URL + password. It's for trusted use, not public deployment. Feedback welcome.
```

---

## 02 · Product Hunt

**Where:** producthunt.com → launch
**Angle:** the "no account, no signup" consumer angle. Attach the demo video + control-window screenshot.

**Tagline**

```
Your DeepSeek Harness workspace, on any device — free, no account, no signup
```

**Description**

```
dsh-share exposes your local DeepSeek Harness (dsh) web workspace over a secure public tunnel — so you can open it from your phone, iPad, or anywhere with a URL.

No account. No signup. No API token. Just click Start and you get a public https://*.trycloudflare.com URL, auto-generated credentials, and a QR code.

What's inside:
- One-click Cloudflare quick tunnel — free, no account
- Local basic-auth proxy so the tunnel is protected
- dsh web started with the public URL trusted, so the browser accepts API calls
- QR code for instant mobile access
- Auto-generated credentials, regenerable from the UI
- Automatic app updates — the bundled DeepSeek Harness stays current with no manual steps

Built entirely with DeepSeek v4 Flash. MIT licensed. macOS, Windows, and Linux.
```

---

## 03 · Reddit self-post

**Where:** r/LocalLLaMA (lead with the DeepSeek angle) · r/selfhosted (lead with the tunnel + no-account angle) · r/opensource
**Angle:** self-post, not a link. Same body works for all three.

**Title**

```
I built a free app that puts your DeepSeek Harness workspace on your phone — no account, no signup
```

**Body**

```
I run DeepSeek Harness (dsh) locally and kept hitting the same wall: dsh web only trusts loopback, so reaching it from my phone or iPad meant starting a tunnel, copying the rotating domain, restarting dsh with --trusted-host, and still having no auth on the tunnel.

So I built dsh-share — an Electron app that does the whole dance in one click:

- Starts a Cloudflare quick tunnel (no account, no token)
- Puts a basic-auth proxy in front of dsh
- Starts dsh with the public URL trusted
- Shows the URL, credentials, and a QR code

Scan the QR and your workspace opens on your phone. Free, MIT licensed, and the whole app was written by DeepSeek v4 Flash.

It also auto-updates: a daily GitHub Action bumps the bundled harness, builds all three platforms, and the installed app updates itself.

Downloads: https://github.com/lixun910/dsh-share/releases
Source: https://github.com/lixun910/dsh-share

Security note: this exposes your machine to anyone with the URL + password — it's for trusted use, not public deployment.
```

---

## 04 · X / Twitter thread

**Where:** x.com → thread
**Angle:** the QR-scan moment is the visual — attach the demo clip to tweet 4. Tag @deepseek_ai and @Cloudflare.

```
1/ Your DeepSeek Harness workspace, on your phone. Free. No account. One click. 🧵

2/ The problem: dsh web only trusts localhost. To reach it from another device you need a tunnel + the rotating domain as --trusted-host + auth. Every session, by hand.

3/ dsh-share automates all of it. Click Start → Cloudflare quick tunnel → basic-auth proxy → dsh web with the public URL trusted. Done.

4/ You get a public URL, credentials, and a QR code. Scan it with your phone camera and your workspace opens in the browser. On your iPad too. [attach demo clip]

5/ The meta part: the entire app was written by DeepSeek v4 Flash. I designed the architecture, it wrote the code, I reviewed it. MIT licensed.

6/ It even updates itself — a daily GitHub Action bumps the bundled DeepSeek Harness, builds all 3 platforms, and the installed app auto-updates.

7/ Free, no account, no signup. macOS, Windows, Linux.
→ https://github.com/lixun910/dsh-share
```

---

## 05 · GitHub

**Where:** github.com/lixun910/dsh-share
**Angle:** topics make the repo findable; the README tweak adds a star CTA + demo GIF slot.

**Topics** (already added to the repo)

```
deepseek, deepseek-harness, cloudflare-tunnel, quick-tunnel, electron, selfhosted, llm, ai, tunnel, workspace
```

**README — add after the intro** (already applied)

```markdown
> ⭐ **If dsh-share saves you an hour, [star the repo](https://github.com/lixun910/dsh-share)** — it helps others find it.

![Demo](docs/demo.gif)
```

> TODO: record a 15s clip of Start → QR → phone, save as `docs/demo.gif`, and the image line renders.

---

## 06 · Demo video script

**Where:** the asset every other post points to
**Angle:** the money shot is the phone scanning the QR. Record at 1080p with captions on.

```
[0:00–0:05] HOOK
Title card: "Your DeepSeek Harness workspace, on your phone." No intro, straight in.

[0:05–0:18] THE PROBLEM
Screen: dsh web open on localhost:3080.
VO: "Your dsh workspace runs here, on your Mac. But it only trusts localhost — so your phone can't reach it. The old fix: a tunnel, a rotating domain, a --trusted-host flag, and no auth."

[0:18–0:32] THE APP
Open dsh-share. Click Start. Show the status flip to Running, the public URL appear, the QR render.
VO: "dsh-share does all of that in one click. Free, no account, no signup."

[0:32–0:50] THE MONEY SHOT
Pick up the phone, scan the QR. Cut to the phone screen: the workspace loads over HTTPS.
VO: "Scan the QR — and your workspace is on your phone. Same files, same sessions, same UI."

[0:50–1:05] CREDENTIALS + SECURITY
Show the username/password and the Regenerate button.
VO: "The tunnel is protected by auto-generated credentials — regenerate them anytime. Only share with people you trust."

[1:05–1:20] THE AUTOMATION
Cut to the GitHub Actions page / a release.
VO: "And it keeps itself current — a daily bot bumps the bundled DeepSeek Harness, builds all three platforms, and the app updates itself."

[1:20–1:30] CTA
"dsh-share. Free, open source, built with DeepSeek v4 Flash. Download it at the link below — and star the repo if it saves you an hour."
```
