# Fundraising Display — event guide

The controller records gifts and runs the audience screen. New portable app
users start with a neutral theme and a $10,000 goal. Existing events keep their
saved goals, wording, fields, and program settings.

## Launch and connect

Open the Windows portable executable, or extract the Mac ZIP and open the app.
One controller window opens; the local server runs in the background on port
8080. No installation or internet is needed during the event.

For **two laptops**, join the same trusted Wi-Fi or wired network. Open
**Settings → Connection & recovery**, then open a listed projector address in the
other laptop's browser. Enter the four-digit code under **The projector laptop**.
Use browser fullscreen. The projector needs no app installation.

For **one laptop with an attached projector**, choose **Open audience window**,
move the window onto the projector, and use fullscreen. Keep both windows open.

The old Python launchers remain available for single-laptop browser use. They do
not provide the portable app's local two-laptop relay, native backups, or server
restart controls. Do not open HTML using `file://`.

## Before the event

1. Rehearse with the actual laptops, projector, and venue network.
2. Allow local network access if prompted. Guest Wi-Fi may isolate devices;
   ask the venue for a network permitting laptop-to-laptop connections.
3. Check that gifts save successfully in the backup folder.
4. Confirm organization, logo, theme, currency, goal, programs, and donor fields.
5. Enter rehearsal gifts, test celebrations, then start a new event.
6. Export a backup to a separate location. Keep laptops awake and on power.

## Record and edit gifts

- Enter a donor name and positive amount. **Anonymous** hides the name on the
  projector but retains it in the operator's private log.
- **Add & show on screen** records and announces a gift. **Add quietly** records
  it without an announcement. **Ctrl/Command + Enter** adds and shows.
- Announcements queue in order. Use **Hold gift on screen**, **Replay last gift**,
  and **Clear screen** to control them.
- The log's **Edit** dialog changes a gift and offers **Void / Restore**. Voided
  gifts leave the totals and projector but remain in backups.
- **Confetti**, **Balloons**, **Fireworks**, and **Big finish** play over the board.
- Updating the goal reveals the target prominently before shrinking it to the
  thermometer. Goal and running total can each be hidden.

## Branding and settings

**Brand & appearance** includes organization name, logo, four theme presets,
custom colors, font style, currency, impact visibility, and donation QR image.
PNG, JPG, and WebP uploads are resized locally; SVG uploads are not accepted.
Logos retain their aspect ratio. **Remove logo** hides the logo.

Appearance changes stay in preview until **Apply appearance**. **Discard changes**
restores the saved appearance. **Restore theme defaults** resets only draft
colors and font. A contrast warning helps identify hard-to-read projector colors.

Currency changes labels only, not the values of gifts or program costs. Upload
the QR image supplied by your donation platform; entering its URL does not
generate a QR code. The display works offline, but online donation pages still
require internet for donors.

Other settings update immediately:

- **Screen & wording:** event title, tagline, QR caption, animation pace, and
  anonymous donor wording. The default is **A friend of {organization name}**;
  the placeholder follows the applied organization name. Customize it or choose
  **Use default wording** to reset it. Blank wording also uses the default.
  This changes gift announcements and the donor wall, not private log/CSV names.
- **Where it goes:** program names, units (people, families, animals, etc.), share
  percentages, and monthly cost per unit. **Normalize to 100** adjusts shares.
- **Gift fields:** data to collect and which fields are public. Removed fields
  with existing values remain in the saved log and CSV.

The board cycles through annual program impact using each program's allocated
share. A gift announcement illustrates what its full amount could support in one
random program; this is not an earmark or a count to sum across programs. Gifts
smaller than an annual unit do not claim a whole unit. Hide impact calculations
if monthly sponsorship does not fit your organization.

## Backups and moving laptops

The portable app automatically saves:

- `event.json`: gifts, settings, IDs, timestamps, voided state, and branding.
- `event.previous.json`: the previous valid event snapshot.
- `donations.csv`: the current ledger; no allocation or summary rows. It is a
  companion export, not a full-fidelity event backup.

**Settings → Backup → Open backup folder** shows the location. Data is in the
operating system's app-data folder, not beside the portable executable.
Replacing or moving the executable does not replace or move donations.

Use **Export event** for a complete backup and **Import event** on another laptop.
Import confirms replacement and archives the existing event first. **Start a new
event** also archives the desktop event before clearing gifts; it keeps branding,
programs, and fields.

To migrate the older browser version, run its controller from this branch using
the same browser and address as before (localhost and 127.0.0.1 have different
storage). Choose **Settings → Backup → Export event**, then import that file in
the portable app. Do not clear browser data until verified. CSV restore is for
older CSV backups; it cannot preserve all metadata or branding.

## Recovery

- **Server stopped:** keep the app open. Automatic recovery tries up to three
  restarts. **Restart server** retries manually while preserving gifts and code.
- **Port 8080 occupied:** close the old launcher or other app using it, then
  restart the server. The app never kills unrelated programs.
- **Projector disconnected:** keep its browser open. It retains the last board
  and catches up on reconnect. Changing the code requires re-pairing.
- **File save failed:** keep the app open. **Export event** to another location,
  fix the storage problem, then **Retry saving**. Check the saved status. A newer
  local recovery snapshot is used on reopening, but is not a substitute for
  separate backups.
- **App crashed:** reopen it and review restored gifts. A new app session has a
  new pairing code; reconnect the projector if asked.
- **Unreadable event:** the app tries the previous valid snapshot. If neither
  file is readable, it stops instead of starting over them. Import a known-good
  backup; original unreadable files are preserved when replacing them.

**Save diagnostic report** includes app version, platform, connection status,
save timing, and IPv4 adapter names and addresses, without donor names or
donation data. Known virtual adapters (such as WSL/Hyper-V and VPN interfaces)
are hidden from projector links and Copy audience link, but retained in this
report. Filtering uses adapter names, not address ranges: a physical LAN using
172.x addresses is still supported.

## Privacy and limitations

Connections stay on the local network, without a public relay. Local **HTTP is
not encrypted**: use a trusted private network. The four-digit code is convenient
pairing, not strong protection against a hostile network. Attempts are
rate-limited; pairing yields a random, signed viewer token valid for up to
24 hours. New codes revoke old tokens.

Only approved display fields reach projector browsers. Anonymous donors' real
names, private fields, and voided gifts remain in the controller. Native file
operations and restart controls are not exposed through the network server.

Initial portable builds are unsigned; Mac builds are not notarized. OS warnings
or managed-device restrictions are possible. Rehearse with the downloaded build.
No test suite guarantees recovery from every hardware, power, disk, or network failure.

## Architecture and tests

The interface is vanilla HTML/CSS/JavaScript. `dcx.js` renders templates;
`branding.js` validates and applies colors; `controller-settings.js` provides
branding and desktop controls. `lan-link.js` connects projector browsers to the
local server; BroadcastChannel serves same-app windows. Fonts are bundled.

The desktop window, supervised server, read-only projector feed, and event files
are in `desktop/`. The controller uses a stable internal origin independent of
the HTTP server, keeping recovery controls available during server failures.

From the root: `npm test`, `npm run test:e2e`, and `npm run test:desktop`.
Browser tests require `npx playwright install chromium`. Run the two browser-based
suites separately because they share port 8080. Tests cover storage recovery,
queues, editing/voiding, privacy, pairing, reconnection, branding, and previous
loading/donor-wall regressions.
