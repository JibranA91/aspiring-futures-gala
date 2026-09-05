# Aspiring Futures — Gala Fundraising Display

A live donation display for a fundraising gala. An operator enters each gift on
the off-screen **Gala Control** console, and an **Audience Screen** on the
projector reacts in real time — animating each gift, a rising thermometer,
program breakdowns, the running total, and the goal.

It's a **standalone static web app**: plain HTML/CSS/JS, no build step and no
framework. The app itself lives in [`gala/`](gala/).

## Quick start

**Double-click a launcher** in this folder:

- **Windows:** `launch.bat`
- **macOS / Linux / Git Bash:** `launch.sh` (or run `./launch.sh`)

It serves the app on **http://localhost:8080/** and opens the control console in
your browser. Keep that window open during the event; close it (or press
Ctrl+C) to stop the server.

**Or run it manually** (needs Python installed):

```bash
cd gala
python -m http.server 8080
```

Then open **http://localhost:8080/**.

> Serve it over HTTP as above — don't open the files directly with `file://`.
> The live controller ↔ audience sync needs a real origin.

## Using it

- **Gala Control** — `http://localhost:8080/` — enter gifts and drive the screen.
- **Audience Screen** — `http://localhost:8080/audience.html` — the projector
  view. For a single laptop, open **Settings → This laptop → Open audience
  window**; for two laptops, pair them with the on-screen code.

The full event guide (one- vs two-laptop setup, settings, backup, reset) and the
architecture notes are in **[`gala/README.md`](gala/README.md)**.

## Layout

```
gala/          the app — see gala/README.md
launch.bat     Windows one-click launcher (port 8080)
launch.sh      macOS / Linux / Git Bash launcher (port 8080)
```
