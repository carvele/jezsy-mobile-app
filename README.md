# JezSy Mobile App

An [Expo](https://expo.dev) project using a **dev client with prebuild (CNG)** -- not Expo Go. `android/` is generated and gitignored; there is no committed `ios/`.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Run the app (builds and installs the dev client on a connected device/emulator)

   ```bash
   npm run android
   ```

**Do not use `expo start` / Expo Go** for this project. Three load-bearing native modules -- `react-native-vision-camera`, `react-native-mediapipe-posedetection`, `react-native-worklets-core` -- back the body scan and AR try-on features and are unavailable in Expo Go. `npm start` still works for iterating on screens that don't touch those modules, but always verify camera/pose/AR changes with `npm run android` against a real dev-client build.

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Environment setup

This project uses environment variables for Supabase configuration. Copy `.env.example` to `.env` and fill in the values before starting the app.

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Do not commit `.env`; it is ignored by `.gitignore`.

### Supabase MCP (for Claude Code / AI-assisted development)

Copy `.mcp.json.example` to `.mcp.json` and fill in a personal access token
from your own [Supabase account settings](https://supabase.com/dashboard/account/tokens)
(needs read access to the `wufcmtndotfvxvvxkamv` project). This lets your AI
assistant query the live schema, check RLS policies, and apply migrations
directly. `.mcp.json` is gitignored -- each developer's token stays local.

## Database migrations

Schema changes live in `supabase/migrations/`, applied against a live, shared
Postgres project. See [supabase/migrations/README.md](supabase/migrations/README.md)
for the idempotency conventions every migration in this repo must follow.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
