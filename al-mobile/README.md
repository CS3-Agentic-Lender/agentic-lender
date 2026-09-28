# al-mobile: borrower app (iOS)

SwiftUI app for borrowers. Owner: Ibrahima.

| | |
|---|---|
| App ID | `ie.mtu.agenticlender` |
| Minimum iOS | 17.0 |
| Devices | iPhone |
| Language | Swift 5, SwiftUI |
| Packages | Firebase iOS SDK (Auth, Firestore) through Swift Package Manager |

## Prerequisites

- A Mac with Xcode 16 or later (the project uses Xcode 16's synchronized folders)
- An iOS 17+ Simulator runtime (Xcode > Settings > Components)

## Run it

1. Open `al-mobile/AgenticLender.xcodeproj` in Xcode. The first open downloads the Firebase packages, which takes a few minutes.
2. Pick the **AgenticLender** scheme and any iPhone Simulator.
3. Press **Run** (⌘R).

**Check:** the Welcome screen shows "Agentic Lender" and a **Sign in** button that opens the Sign in screen.

## Run the tests

In Xcode press ⌘U, or from `al-mobile/`:

```bash
xcodebuild test -project AgenticLender.xcodeproj -scheme AgenticLender \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

Use any iPhone Simulator name from `xcrun simctl list devices`. GitHub Actions runs the same tests on every PR that changes `al-mobile/` (`.github/workflows/mobile.yml`).

## Project layout

```
AgenticLender/
  AgenticLenderApp.swift   entry point and navigation stack
  Screens/                 one SwiftUI view per screen, plus Route (where a screen can navigate)
  Config/BackendConfig.swift   where the app finds the Firebase emulators
  Assets.xcassets
AgenticLenderTests/        XCTest unit tests
```

Xcode picks up new files in these folders automatically, so adding a file doesn't touch `project.pbxproj`.

## Connecting to the local backend

The app talks to the Firebase emulators started from `al-core/` (see [al-core/README.md](../al-core/README.md)). `BackendConfig` holds the address:

- **Simulator:** nothing to set. It shares the Mac's network, so `localhost` works.
- **Real iPhone:** `localhost` is the phone itself. Put the phone and Mac on the same Wi-Fi, then in Xcode open **Product > Scheme > Edit Scheme > Run > Arguments** and add the environment variable `EMULATOR_HOST` set to the Mac's Wi-Fi address (System Settings > Wi-Fi > Details). The emulators also have to accept connections from other devices, which needs a change in `al-core/firebase.json` (ask the al-core owner).

No `GoogleService-Info.plist` or API key is needed: local development uses the `demo-al` emulator project.

## Running on your own iPhone

1. Plug the iPhone into the Mac and select it as the run destination.
2. In the **AgenticLender** target > **Signing & Capabilities**, pick your personal team (a free Apple ID works).
3. If Xcode says the app ID is taken, change the bundle identifier to something personal, such as `ie.mtu.agenticlender.yourname`.
4. On the iPhone, trust the developer profile under **Settings > General > VPN & Device Management**.

With a free Apple ID the app stops opening after 7 days; run it from Xcode again to reinstall.

**Don't commit** the team or bundle ID change from steps 2 and 3: they are personal to your Apple account. Discard `project.pbxproj` changes before committing (`git restore al-mobile/AgenticLender.xcodeproj/project.pbxproj`).
