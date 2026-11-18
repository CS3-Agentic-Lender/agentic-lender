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

The end-to-end UI tests need the emulators and the gateway running, so CI doesn't run them. Start the stack and run `./run-ui-tests.sh`: see "UI tests" in [docs/infrastructure.md](../docs/infrastructure.md).

## Project layout

```
AgenticLender/
  AgenticLenderApp.swift   entry point and navigation stack; starts Firebase
  Screens/                 one SwiftUI view per screen, plus Route (where a screen can navigate)
  SignUp/                  sign-up form, validation, Firestore profile and account service
  Design/                  Pine & Oat colour tokens and shared form controls
  Config/BackendConfig.swift   where the app finds the Firebase emulators
  Config/FirebaseSetup.swift   connects Firebase Auth and Firestore to the emulators
  Assets.xcassets
AgenticLenderTests/        XCTest unit tests
AgenticLenderUITests/      end-to-end UI tests against the local stack (own scheme, not run in CI)
run-ui-tests.sh            runs the UI tests
```

Xcode picks up new files in these folders automatically, so adding a file doesn't touch `project.pbxproj`.

## Connecting to the local backend

The app talks to the Firebase emulators started from `al-core/` (see [al-core/README.md](../al-core/README.md)). `BackendConfig` holds the address:

- **Simulator:** nothing to set. It shares the Mac's network, so `localhost` works.
- **Real iPhone:** `localhost` is the phone itself. Put the phone and Mac on the same Wi-Fi, then in Xcode open **Product > Scheme > Edit Scheme > Run > Arguments** and add the environment variable `EMULATOR_HOST` set to the Mac's Wi-Fi address (System Settings > Wi-Fi > Details). The emulators also have to accept connections from other devices, which needs a change in `al-core/firebase.json` (ask the al-core owner).

No `GoogleService-Info.plist` or API key is needed: local development uses the `demo-al` emulator project.

## Demo build

The demo runs on the iOS Simulator on the presenting Mac; an iPhone through Xcode (below) is the alternative. There is no App Store or TestFlight build, since that needs a paid Apple Developer account.

The `AL_BACKEND` build setting picks the backend: `LOCAL` (the default) uses the emulators and the local gateway above, and `HOSTED` uses the hosted Firebase project and the deployed API at `https://api.agentic-lender.com`. It's built into the app, so it holds when the app is opened from the home screen.

**From Xcode:** add `AL_BACKEND = HOSTED` to `Config/Hosted.xcconfig` (it's commented out in `Hosted.example.xcconfig`) and press Run. Take the line out again for local work. It lives in the xcconfig, not on the target, so Run really builds what the file says.

**From the command line:** the setting on the command line wins, so this builds the demo whatever `Hosted.xcconfig` says. Installing and launching it yourself matters: pressing Run in Xcode afterwards would rebuild it from the xcconfig.

```bash
xcodebuild build -project AgenticLender.xcodeproj -scheme AgenticLender \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build AL_BACKEND=HOSTED
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/AgenticLender.app
xcrun simctl launch booted ie.mtu.agenticlender
```

The hosted Firebase settings stay out of the repo, which is public. Copy `Config/Hosted.example.xcconfig` to `Config/Hosted.xcconfig` (gitignored) and fill it in from the iOS app registered in the hosted Firebase project; ask Dumi for the values. `Config/Base.xcconfig` includes it, and `Config/AppInfo.plist` passes the settings into the app's Info.plist. Without them, a `HOSTED` build stops at launch and names the settings it doesn't set; a `LOCAL` build only needs it for the fast-track fee (below).

**The fast-track fee (Stripe).** Pay needs Stripe's publishable test key on any build, local or hosted: put `AL_STRIPE_PUBLISHABLE_KEY = pk_test_…` in the same `Config/Hosted.xcconfig`, from the team's Stripe sandbox (Developers, API keys; ask Dumi for an invite). Only a `pk_test_` key is accepted. Without it, Pay says the payment couldn't start and the log names the setting. To actually take payments, al-core also needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: see "The fast-track fee" in `al-core/README.md`.

## Running on your own iPhone

1. Plug the iPhone into the Mac and select it as the run destination.
2. In the **AgenticLender** target > **Signing & Capabilities**, pick your personal team (a free Apple ID works).
3. If Xcode says the app ID is taken, change the bundle identifier to something personal, such as `ie.mtu.agenticlender.yourname`.
4. On the iPhone, trust the developer profile under **Settings > General > VPN & Device Management**.

With a free Apple ID the app stops opening after 7 days; run it from Xcode again to reinstall.

**Don't commit** the team or bundle ID change from steps 2 and 3: they are personal to your Apple account. Discard `project.pbxproj` changes before committing (`git restore al-mobile/AgenticLender.xcodeproj/project.pbxproj`).
