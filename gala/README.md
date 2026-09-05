# Aspiring Futures — Gala Fundraising Display

A live donation display for a fundraising gala. An operator sits off to the side
with the **Gala Control** console and types in each gift as it's announced; a
second **Audience Screen** on the projector reacts in real time — animating each
gift, a rising thermometer, category breakdowns, the running total, and the goal.

This is a **standalone static web app** — plain HTML/CSS/JS, no build step and no
framework CDN. Open it in a browser and it runs.

---

## Running it

**Easiest:** from the project root, double-click **`launch.bat`** (Windows) or
run **`./launch.sh`** (macOS / Linux / Git Bash). It starts a local server on
port **8080** and opens the control console in your browser. Keep that window
open during the event; close it to stop.

**Manually:** from the project root, run the bundled no-cache server (don't open
the files as `file://` — the live cross-window sync needs a real origin):

```bash
python serve.py 8080
```

Then open **http://localhost:8080/** for the control console.

> Fonts (Google Fonts) and the two-laptop relay (MQTT) need internet. Everything
> else — entering gifts, the audience animations, single-laptop mode, local
> backup, CSV — works fully offline.

---

## Using it at an event

### One laptop (laptop + projector on the same machine)

1. Open **Gala Control** (`/` → `index.html`).
2. Click **Settings → The projector laptop → This laptop**, then
   **Open audience window**. Drag that window onto the projector and press
   fullscreen (F11).
3. Both windows stay in sync automatically. Start entering gifts.

### Two laptops (one records, one projects over the internet)

1. On the recording laptop, open **Gala Control**. In **Settings** keep
   **Second laptop** selected — it shows a **pairing code** (e.g. `M58QZ-U7UGP`).
2. On the projector laptop, open **`audience.html`** and type that code (or use
   **Copy audience link** on the console and open the link on the projector).
3. They connect through a public MQTT relay. **Donor names and amounts are
   end-to-end encrypted** with the pairing code before they leave the recording
   laptop — the relay only ever carries ciphertext. Generating a **New code**
   unpairs the projector.

### Entering a gift

- Type a **donor name** (or mark it **Anonymous**) and an **amount** (quick-amount
  chips are there for speed), then **Add & show on screen** — this plays the gift
  animation on the projector. **Add quietly** records it without the animation.
- **⌘/Ctrl + Enter** adds-and-shows from anywhere.
- The **Log** lets you **Show** any past gift again or **Void** a mistaken entry
  (voids are excluded from totals but kept in the CSV).
- On the audience screen each shown gift appears as a compact card **over** the
  live board (the totals, thermometer and donor wall stay visible), translated
  into a sponsorship program as **people supported for a year** — e.g. "6 children
  supported for a year of shelter home living". Gifts shown in quick succession
  **queue** and play one after another rather than cutting each other off.

### Settings

- **Where it goes** — the sponsorship programs each gift is split across. Each
  has a **share %** (how the money is allocated) and a **monthly cost** (what it
  costs to sponsor one beneficiary). Both drive the audience impact figures;
  "Normalize to 100" fixes the percentages. Defaults: Student living & education
  30% / $65, Family financial assistance 25% / $120, Shelter home living 25% /
  $60, Books, supplies & laptops 20% / $15.
- **Gift fields** — add/rename the fields you collect per gift (text / number /
  choice), and choose which appear on the audience screen vs. console-only.
- **Screen & wording** — event name, tagline, QR caption, and animation pace.
- **The goal** — set a target and reveal the goal and/or running total on screen.
- **Impact figures** — each shown gift is translated into a **randomly chosen
  program** (from "Where it goes", gated by gift size) as the number of people
  it supports for a year — e.g. "6 families supported for a year of family
  financial assistance". The board's impact figure **cycles through the
  programs**, each showing how many people its own share of the total supports
  for a full year (e.g. "5 students · Student living & education · funded from
  30% of tonight's gifts") — honest, never pooling the whole total into one line.

### Backup — nothing is lost

- Every gift is saved to this browser's **local storage** the instant it lands —
  silently, no prompts.
- For an off-browser copy, click **Settings → Backup → Back up to a file…** and
  pick one CSV file **once**. After that, every gift rewrites that single file in
  the background — no download, no dialog. (This uses the File System Access API,
  so it needs Chrome or Edge; elsewhere use **Export a CSV copy now** for a manual
  snapshot.) After a reload, click **Reconnect** once to resume writing to it.
- **Export a CSV copy now** downloads a dated snapshot on demand, and **Restore
  from CSV** reads a previous export back in (handy if a laptop dies mid-event).
- The CSV is a plain **ledger of the gift entries** — donor, amount, and the
  gift fields you configured — one row per gift. No category-allocation columns
  or summary row.
- **Start a new event** (bottom of Backup) clears the board to a fresh state and
  begins a new CSV file, after a confirmation — your categories, fields and
  wording are kept.

---

## How it's built

The screens started as HTML/CSS/JS prototypes that ran on a heavyweight CDN
runtime (React + Babel + a streaming template engine). This app **replaces that
entire runtime** with a small dependency-free one, so it's a plain static site.

```
gala/
  index.html        Gala Control console        (loads controller.js)
  audience.html     Audience / projector screen (loads audience.js)
  ds/styles.css     Organic design-system tokens        (reused as-is)
  assets/           logo
  js/
    dcx.js          ~250-line vanilla runtime: {{ }} bindings, sc-for / sc-if,
                    events, refs, and a keyed DOM reconciler. Replaces the
                    prototype's React/Babel/streaming runtime.
    gala-link.js    controller ⇄ audience transport: BroadcastChannel on one
                    machine, encrypted MQTT-over-WebSocket between two   (reused)
    image-slot.js   the "Give from your seat" QR drop slot (localStorage-backed)
    controller.js   Gala Control component logic   (ported from the prototype)
    audience.js     Audience Screen component logic (ported from the prototype)
```

- **`dcx.js`** is the substantive new piece. It reproduces exactly the subset of
  the design runtime the two templates use — value/handler bindings, list and
  conditional rendering, `onChange`-fires-on-input semantics, `ref` callbacks,
  controlled inputs, and keyed reconciliation so focused fields keep their caret
  and CSS animations replay only when a key changes or a node mounts.
- The **component logic** (`controller.js`, `audience.js`) and the **templates**
  (inside each HTML file's `<template id="tpl">`) are ported from the design
  prototype essentially verbatim — the only change is that the console's
  "audience window" now points at this app's real `audience.html`, and the live
  preview pane embeds it as an `<iframe>`.
- **`gala-link.js`** and **`ds/styles.css`** are reused unchanged from the
  handoff bundle; they were already framework-independent.

State is shared through one `localStorage` key plus the link transport, so the
console, the embedded preview, and the projector window all stay in sync.

Built from a design handoff — the `aspiring-futures-donation-display/` bundle
(kept locally and git-ignored; not part of this repo).
