<p align="center">
  <img src="./readme-banner.svg" alt="Unimate — your campus, in one place" width="100%">
</p>

<h1 align="center">Unimate</h1>
<p align="center"><strong>Your companion for university study and campus life.</strong><br>Timetables, notes, campus services, and Uni by your side.</p>
<p align="center"><a href="./README.md">简体中文</a> · <strong>English</strong></p>
<p align="center"><a href="#features">Features</a> &nbsp; · &nbsp; <a href="#try-the-demo">Try the demo</a> &nbsp; · &nbsp; <a href="#development-testing-and-android-builds">Development</a> &nbsp; · &nbsp; <a href="#data-backup-and-privacy">Data &amp; privacy</a></p>

---

Unimate is built for Android, with **Beijing University of Chemical Technology (BUCT)** as its first university deployment. The Android application ID is `com.unimate.app`. The project is currently a student-built demonstration and personal-use application; see the [PRD](./PRD.md) and [project context](./docs/context.md) for requirements and acceptance details.

## Unimate at a glance

| 📅 Timetables | 📝 Notes & exams | 📷 Extracurriculars |
| :--- | :--- | :--- |
| Weekly views, academic imports, course management and sharing | To-dos, exam recognition and local reminders | Activity records, self-assessment and photo materials |
| **💬 Uni assistant** | **🏫 Campus services** | **☁️ Backup & transfer** |
| Local rules for common requests, with an online option for open questions | University links, an illustrative map and useful tools | Account backup, optional encrypted sync and local ZIP |

> **Trying Unimate?** Choose the demo account `admin` / `buct` on the sign-in screen. See below for feature and university availability.

## Contents

- [Features](#features)
- [University and academic-system support](#university-and-academic-system-support)
- [Data, backup and privacy](#data-backup-and-privacy)
- [Try the demo](#try-the-demo)
- [Development, testing and Android builds](#development-testing-and-android-builds)
- [Architecture and repository](#architecture-and-repository)
- [Limitations and documentation](#limitations-and-documentation)

---

## Features

### Timetables: view, manage and share

- View courses by week, check times and locations, move between weeks and see the next class. Courses can be distinguished by color, including manually selected colors.
- Add and edit courses, configure the first week, term length and period times, and create or switch between multiple timetables.
- Import a timetable from an academic system. At BUCT, the student signs in and queries the page in the embedded browser, then starts recognition. Other universities using the Zhengfang system use a separate import path. Results depend on the university's system and page format.
- Share a timetable using share content and a QR code. Review the content before sharing personal schedules.
- Set local reminders for classes and related notes. Android notification and alarm permissions, background restrictions and vendor power policies affect delivery; verify timing on the target device.

### Notes and exams

- Create, edit, complete, search and filter notes, including titles, content and reminder times.
- Recognize exam schedules on supported academic pages and add them to notes with reminders one day and 30 minutes in advance. Existing entries are skipped on repeated imports.
- Recognize grades from a supported academic page and save them locally. **Grades are not uploaded to the account cloud or included in device-transfer backups.** The user confirms before replacing existing grades.
- Students sign in and operate academic pages themselves; the app does not fill in their academic credentials. Availability depends on the university profile and page structure.

### Extracurricular records and evidence

- The BUCT profile offers five categories—moral development, academics, physical education, arts and labor—for recording activities, dates, descriptions, self-assessed scores and photos, with category and overall summaries.
- Photo watermarks are optional. Watermarks and photo evidence are generated locally; addresses can be entered manually without a third-party map key. Individual records and their materials can be exported.
- Scores are **self-assessment references**, not official university results. The Beijing International Studies University profile does not include this module.

### Campus services and tools

- Open university websites such as academic services, online courses and the library from a school profile. Website availability and sign-in depend on the university and network.
- BUCT tools include an offline building map, public MOTION venue status, local fitness-score estimates, academic-system classroom availability, and course catalog/selection-target management.
- The campus map is illustrative, not surveyed navigation; fitness scores are estimates. Some queries require a network or academic-system sign-in. The selection tool can save targets and open the school's selection page; **it does not submit course selections for the user**.
- Weather is optional and disabled by default. Enabling it requires a network connection.

### Uni text assistant

- Ask about today's or tomorrow's classes, search local notes, open features, or propose a new note or reminder. Creating a note or reminder requires user confirmation.
- Common requests are handled by local rules first; open-ended requests can use the Unimate online service. If the network or service is unavailable, the app attempts local rules; not every question can be answered offline.
- Online requests contain text deliberately sent by the user. The client does not automatically attach timetables, teachers, classrooms or notes. Avoid entering information you do not wish to share. See the [Uni architecture](./docs/agent-architecture.md).

---

## University and academic-system support

| University | Profile and availability |
| --- | --- |
| Beijing University of Chemical Technology (BUCT) | First deployment; its profile is bundled with the APK and listed first. Timetable import uses the BUCT page-table parser. |
| Beijing International Studies University (BISU) | Provided as a signed cloud profile: shown as available to download before it can be used. The profile does not include extracurricular records. |
| Other universities | Listed as “in development,” not fully supported. The timetable identification flow can attempt Zhengfang imports, depending on the actual system. Import paths for Qiangzhi, URP and other types are not complete. |

School profiles and declarative parser rule packs support signature verification and updates; failed verification falls back to bundled content. See [school profiles](./docs/school-pack.md) and [parser adapters](./docs/adapters.md).

---

## Data, backup and privacy

A complete copy of app data remains on the device; cloud services provide backup and recovery. **The two cloud modes have different trust boundaries:**

| Mode | How it works and its trade-off |
| --- | --- |
| Account sign-in (recommended default) | Timetables, notes, extracurricular materials and photos can be backed up and recovered after signing in on a new device. The plaintext password is not uploaded; the client derives a verifier. The server holds the at-rest key and can therefore read backups. |
| End-to-end encrypted sync (optional) | Use a sync code or one derived from an account and passphrase. The server stores AES-256-GCM ciphertext; the passphrase and recovery code are neither uploaded nor stored. Data cannot be recovered if both the passphrase and recovery code are lost. |
| Local ZIP backup | Export and import a `.unimate.zip`; offline transfer is also available under “Account and recovery” on the sign-in screen. Grades are excluded from device-transfer backups. |

The cloud currently uses **Cloudflare nodes outside mainland China**. Readable backups in account mode involve cross-border data transfer. Before operating for real users, move storage to mainland China or address applicable personal-information and cross-border transfer requirements. See the [cloud service documentation](./cloudflare/sync-worker/README.md).

---

## Try the demo

1. Start the project and select the **demo account** on the sign-in screen (`admin` / `buct`).
2. Choose a school and explore the sample timetable, notes and extracurricular records. Demo data is anonymized.
3. Try the timetable toolbox, notes and Uni. Some native entry points use demo samples or fallbacks in a desktop browser; this does not replace an Android test.

The signed-in session persists. Initial sign-in, signing in again after logging out, and changing schools require the relevant network access. Service availability depends on deployment and network conditions.

---

## Development, testing and Android builds

### Environment and local preview

The app uses **Vue 3, TypeScript, Vite, Pinia and Capacitor 6**. Cloud services use Cloudflare Workers, Pages and R2. Install npm and a Node.js version that supports the test scripts' `--experimental-strip-types` flag.

```bash
npm ci
npm run dev
```

Open the address printed by Vite. Installation and builds create files; on Windows, read the [C-drive storage policy](./C_DRIVE_STORAGE_POLICY.md) first and configure download, cache and output locations accordingly.

### Useful checks

```bash
npm run test:parser    # BUCT timetable parser
npm run test:academic  # grade and exam recognition
npm run test:sync      # cloud sync
npm run test:boot      # startup flow
npm run test:order     # declaration order and name collisions
npm run test:css       # CSS constraints
npm run test:agent     # Uni Agent
```

See [package.json](./package.json) for all test commands. Follow [AGENTS.md](./AGENTS.md) for checks relevant to a change. The list above is not a claim that the tests were run for this documentation update.

### Android APK

Prepare JDK 17, Android SDK 34 and the required Node.js environment. For initial setup, see `scripts/setup-android-toolchain.ps1` after checking download and storage locations. Use the project script for an APK:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

The script runs tests, builds, syncs Android and checks package contents. Its output is `artifacts/android/unimate-debug.apk`. Native WebView, camera, file selection, notifications and background reminders still require testing on a real device. A successful build alone does not establish that device testing passed.

---

## Architecture and repository

```text
src/                  Vue screens, components, Pinia state and services
android/              Capacitor Android project and native bridges
cloudflare/           accounts, backup, Pages proxy and online assistant
catalog/              school profile source files
public/catalog/       signed manifest and downloadable profiles
adapters/             declarative parser rule packs
fixtures/             anonymized samples
tests/                automated tests
scripts/              build, release and validation scripts
docs/                 architecture, deployment and project context
p4-parser/            standalone grade/exam parser workspace
p5-assistant/         standalone AI assistant workspace
```

The UI and local data layer live in `src/`. Android bridges provide device features such as WebView and notifications. Cloud services provide account backup, encrypted sync and the online assistant endpoint. P4 and P5 are separate workspaces; consult their READMEs and NOTES for integration status.

---

## Limitations and documentation

- “In development” does not mean a university is supported. Academic-system changes, authentication and network conditions can prevent imports.
- Browser preview and automated tests do not replace device testing. Reminder delivery also depends on device permissions and background policies.
- School links and self-assessment tools do not make this an official university app or its results official scores.

Further reading: [Engineering rules](./AGENTS.md) · [PRD and acceptance criteria](./PRD.md) · [Project context](./docs/context.md) · [Deployment](./docs/deploy.md) · [Third-party notices](./THIRD_PARTY_NOTICES.md)
