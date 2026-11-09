# Beer Deals in the app stores

The owner decided on 2026-11-07 to publish in both Google Play and the App Store, as a private
individual, on accounts he already has. There is no Mac, so anything Apple-specific is built on
GitHub's macOS runners.

## What the stores require of every app (done in 0.43.0)

- **Privacy policy URL:** https://beer-deals.vercel.app/privacy. It opens without an account.
- **In-app account deletion:** Settings → הפרטיות שלי → מחיקת החשבון שלי (migration 0070).
- **Contact address:** beerdeals.app@gmail.com.
- **Age rating: 18+.** The app is about alcohol. In Play's content rating questionnaire, answer that
  it references alcohol. In App Store Connect, the age rating is "Alcohol, Tobacco, or Drug Use or
  References: Frequent".

## Google Play: a Trusted Web Activity

The Android app is Chrome showing the live site full-screen under the package `app.beerdeals`
(`android/app.json`). It is not a copy of the site, so every release of the site is a release of the
app. Web push from the site becomes Android notifications.

The bundle is built by the **"Android app (Google Play bundle)"** workflow (`.github/workflows/android.yml`,
`scripts/android/build-twa.mjs`).

### 1. The upload key (owner, once, about 5 minutes)

The upload key signs what you upload. After the first upload, Google signs the copy users install with
its own key (Play App Signing), so a lost upload key can be reset through Play support; nothing is lost
for good. Still, keep the file and the password somewhere safe, such as a password manager.

In PowerShell, on your own computer:

```powershell
winget install Microsoft.OpenJDK.17
```

Open a new PowerShell window so the install takes effect, then:

```powershell
keytool -genkeypair -v -keystore beer-deals-upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

keytool asks for a password (choose one and save it) and for a name; "Ori" is enough. Then put the key and
the password into GitHub's secrets. Each command asks for the value, so the secrets never appear in
chat or in a file:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("beer-deals-upload.keystore")) | gh secret set ANDROID_KEYSTORE_BASE64 --repo yoni546/beer-deals
gh secret set ANDROID_KEYSTORE_PASSWORD --repo yoni546/beer-deals
gh secret set ANDROID_KEY_PASSWORD --repo yoni546/beer-deals
```

Give the same password to both: keytool uses the store password for the key unless you set a separate one.

Finally, print the key's fingerprint. It is public, and it goes into `android/app.json` → `certSha256`:

```powershell
keytool -list -v -keystore beer-deals-upload.keystore -alias upload
```

Copy the line `SHA256: AB:CD:…` into the chat.

### 2. Build

GitHub → Actions → "Android app (Google Play bundle)" → Run workflow. The `.aab` file is in the run's artifacts.

### 3. Play Console (owner)

1. Create an app named "מבצעי בירה", default language Hebrew, of type App, free.
2. Under Testing → Closed testing, create a track and upload the `.aab`. Google offers Play App Signing:
   accept it. Under Setup → App signing, copy the **app signing key** SHA-256 into the chat as well.
   Both fingerprints go into `android/app.json`.
3. Personal accounts created after November 2023 must run a closed test with **at least 12 testers for
   14 days in a row** before they can publish to everyone. Add the testers' Gmail addresses to the track.
4. Fill in the store listing (texts and screenshots are prepared in `store/`), the data safety form
   (answers in `store/data-safety.md`), content rating, target audience 18+, and the privacy policy URL.

## App Store

To come after Google Play is in closed testing. The plan:

- **Wrapper:** Capacitor, loading the live site.
- **Build and signing:** on GitHub's macOS runners, with fastlane and an App Store Connect API key, so
  no Mac is needed.
- **Notifications:** a WKWebView cannot receive web push, so the iOS app needs native push (APNs) and a
  server change that sends it.
- **Review risk:** Apple rejects apps that are "just a website" (Guideline 4.2). The app has to justify
  itself with native notifications, sharing, and the saved list working as an app.
