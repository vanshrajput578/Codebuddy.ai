# NEXUS AI Android client

Native Android client built with Kotlin, Jetpack Compose and OkHttp.

## Requirements
- Android Studio with JDK 17
- Android SDK Platform 36
- Gradle 8.13+
- A deployed NEXUS API with HTTPS and a configured APP_ORIGIN

## Build
Open the android/ directory in Android Studio and run the app configuration, or from this directory:

```bash
gradle --no-daemon :app:assembleDebug
```

The APK is written to app/build/outputs/apk/debug/app-debug.apk.

## Connect
On first launch, enter the exact public origin used for the backend APP_ORIGIN, e.g. https://nexus.example.com. It must be the origin only (no API path). The Android client sends that value in the HTTP Origin header because the API enforces exact-origin checks for authentication and writes.

The app supports account registration/login, session restoration, chat, voice-to-text dictation in the chat composer, task monitoring and approve/reject/pause/resume/cancel actions, and provider configuration. Voice dictation launches the Android speech-recognition service; NEXUS receives only recognized text and does not upload or persist raw audio. Provider API keys are submitted to the backend and are not persisted in app preferences.

The server-issued HttpOnly session cookie is persisted encrypted with an AES key held by Android Keystore. CSRF tokens are refreshed from GET /api/auth/me after session restoration. No session token or provider API key is stored in plaintext preferences.

Only HTTPS API origins are accepted in all builds. The app disables cleartext HTTP traffic.

## Current limitations
- Push notifications, file upload, biometric re-authentication, offline queueing and Play Store signing are not implemented.
- Voice dictation requires a compatible speech-recognition service on the device; language availability and recognition quality depend on that service.
- Android supports creating tasks, generating plans, inspecting each step and approving/rejecting or controlling existing tasks.
- This app is a client for a deployed backend; no public production API URL is configured in this repository.
