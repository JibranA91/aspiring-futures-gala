# GiveStage

A customizable fundraising controller and live projector display. Record gifts,
edit or void entries, celebrate milestones, and show your organization's colors,
logo, programs, and fundraising goal.

## Portable app — no installation

Get the ready-to-run app from [Releases](https://github.com/JibranA91/GiveStage/releases).
Download an app listed under **Assets**, not the source-code archives.

- **Windows:** download the Windows portable `.exe` and double-click it.
- **Mac:** download the matching Mac `.zip`, extract it, and open **Fundraising
  Display.app**. Choose **arm64** for Apple Silicon or **x64** for Intel.

One controller window opens. Its local server starts in the background on
**port 8080**. No terminal, Python, Node.js, or internet is needed to run the
downloaded app. Keep the app open throughout the event.

These builds are **unsigned**, and Mac builds are not notarized.
Windows or macOS may warn or block them; managed devices may require IT approval.
Do not disable system security protections. Signing is a separate release step.

### Connect the projector

1. Put both laptops on the same **trusted Wi-Fi or wired network**.
2. Open **Settings → Connection & recovery** in the controller.
3. On the projector laptop, open the displayed address in its browser.
4. Enter the controller's **four-digit code**, then use browser fullscreen.

Only the controller laptop needs the app. Guest Wi-Fi may block communication
between devices; firewall or local network permission may also be required.
If several addresses are shown, use the one belonging to the shared network.
Known virtual-adapter addresses are hidden here and retained in diagnostic reports.

For one laptop with an attached projector, choose **Open audience window**, move
it to the projector, and use fullscreen (Windows: F11; Mac: View → Toggle Full Screen).

### Customize, save, and recover

- **Brand & appearance:** logo, theme presets/custom colors, fonts, currency,
  impact visibility, and donation QR image. Preview, then **Apply appearance**.
  Other event settings still update immediately.
- **Connection & Recovery:** at the top of Settings, view connection status,
  restart the server, or save diagnostics. The controller stays available during
  server failure. Automatic recovery makes up to three restart attempts.
- **The Projector Laptop:** alongside connection controls, copy the projector
  link, manage the pairing code, or open an audience window on this laptop.
- **Backup:** automatically saves `event.json`, a previous-version backup, and
  `donations.csv`. **Open backup folder** shows their location.
  **Export event / Import event** transfers the full event and branding.
  Backup spans the row below connection controls and includes **Retry saving**.

Portable describes the executable, **not the event data**. Moving the app does
not move donations; export your event before changing laptops. Replacing the app
does not replace its data folder. Keep a separate exported backup.

See the [event guide](gala/README.md) for controls, recovery, privacy, and
migration from the older browser version.

## Development

Requires Node.js **22.12 or newer**; end users do not need these tools.

```bash
npm ci
npm start
```

The original `launch.bat`, `launch.sh`, and `python serve.py 8080` remain
available for **single-laptop browser mode** and need Python. Use the portable
app for offline two-laptop connections and server controls. Never use `file://`.

```bash
npm test
npx playwright install chromium
npm run test:e2e
npm run test:desktop
```

Run browser and desktop suites separately: both use port 8080. Tests use temporary
event data, never the operator's event. GitHub Actions runs unit tests on Linux,
Windows, and Mac, plus browser tests and Windows/Mac desktop tests.

### Build portable downloads

```bash
npm run portable:win
npm run portable:mac
```

Build Windows on Windows and Mac on macOS. Output is in the ignored `dist/`
folder. **Build portable apps** in GitHub Actions produces downloadable artifacts
on relevant pull requests or manual runs; it does not publish a release.
Test the actual downloaded build on its target OS before a live event.

### Publish a release

The build workflow creates downloads; it does **not** publish a release automatically.

1. Update the version in `package.json` and `package-lock.json` together, for
   example to `2.0.1`. Merge the changes into `main` and wait for all tests to pass.
2. Open [Actions → Build portable apps](https://github.com/JibranA91/GiveStage/actions/workflows/portable.yml),
   choose **Run workflow**, select **main**, and run it. Wait for both platform
   builds and packaged-app checks to pass.
3. Open the completed run and download its **windows-portable** and
   **mac-portable** artifacts. Extract the outer artifact ZIPs: they contain the
   Windows `.exe` and two Mac `.zip` files. Keep the Mac app ZIPs intact for upload.
   These temporary workflow artifacts are retained for 14 days.
4. Test the downloaded apps on their target operating systems before publishing.
5. Open [Releases](https://github.com/JibranA91/GiveStage/releases) and choose
   **Draft a new release**. Create a matching tag, such as **v2.0.1**, targeting
   **main**. The release tag must identify the same commit that produced the
   downloads: if `main` has changed since the build, rebuild and recheck first.
6. Add release notes and attach the Windows `.exe` and both Mac `.zip` files.
   Include the unsigned/not-notarized warning and any known limitations. Check
   all three uploads are complete, then choose **Publish release**.

App downloads are release attachments, never Git commits; `dist/` stays ignored.
The repository is named GiveStage; the current app and download filenames still
use **Fundraising Display**.

See GitHub's guides for [running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
and [publishing a release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Layout

- `gala/` — vanilla controller and audience screen, branding, and bundled fonts.
- `desktop/` — app window, protected native controls, local server, recovery, storage.
- `test/`, `e2e/`, `desktop-e2e/` — unit, browser, and desktop tests.
