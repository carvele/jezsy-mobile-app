# Auth, Onboarding & Routing State Machine

This document defines the state machine that governs cold starts, authentication, onboarding, profile completion, and password recovery in `app/_layout.tsx`.

## The Routing Gate (`app/_layout.tsx`)

The root layout relies on several boolean flags (latches) to prevent "flicker" and accidental unmounts while ensuring users end up on the correct screen based on their session state.

### Core Flags

1. `isLoading` & `isProfileLoading`: Handled by `AuthContext`. True when Supabase is fetching the session or profile from the database.
2. `onboardingSeen`: Resolved via local storage. True if the user has completed the swipeable onboarding tutorial.
3. `isPasswordRecovery`: Set by a deep-link listener when a Supabase password recovery URL is intercepted.
4. `flagsReady`: Evaluates to `true` when the session, profile, and onboarding status are fully resolved.
5. `hasBootstrapped`: Gates the initial mount of the navigation `Stack`. It latches to `true` once `flagsReady` is met and *never flips back to false*. This prevents a later profile refresh from entirely unmounting the navigation tree (which causes extreme flicker and resets component state).
6. `routeSettled`: Used to hide the branded bootstrap loader. Latches to `true` only when the `segments` array confirms that the router has successfully navigated the user to their final mandated destination (e.g., `/(tabs)` or `/(auth)/profile-setup`).
7. `hasAuthenticated`: Latches to `true` once a user is confirmed to have a valid session, a completed profile, and is actively navigating inside `/(tabs)`. Once set, the routing gate suspends itself, preventing silent background token refreshes from accidentally kicking the user back to the auth group.

### Sequence of Operations (The Routing Effect)

When the routing `useEffect` evaluates, it processes states in strict precedence order:

1. **Password Recovery Mode**: If `isPasswordRecovery` is true, immediately redirect to `/(auth)/reset-password` regardless of session or profile status.
2. **Profile Deletion**: If the fetched profile is marked `deleted`, force a `signOut()`.
3. **Data Dependency Gate**: If `!flagsReady`, do nothing (wait for dependencies).
4. **Guests (No Session)**: 
   - If `onboardingSeen`, redirect to `/(auth)/welcome`.
   - If `!onboardingSeen`, redirect to `/(auth)/onboarding`.
5. **Authenticated (Session Exists)**:
   - **Incomplete Profile**: If `profile.first_name` is missing, redirect to `/(auth)/profile-setup`.
   - **Complete Profile**: If the user is inside the `AUTH_SCREENS` group, redirect them to `/(tabs)`.

### Race Condition Mitigations

* **Redundant Navigations:** `lastRedirectTargetRef` prevents the router from firing duplicate `replace()` calls on consecutive renders before Expo Router's `segments` update.
* **The "Stuck Loading" Warning:** If `routeSettled` fails to latch within 10 seconds, `__DEV__` mode will emit a console warning to debug edge cases where the destination screen name changed but `AUTH_SCREENS` was not updated.
* **Deep Links**: Handled both on cold start `Linking.getInitialURL()` and in the background via `Linking.addEventListener('url')`. They bypass standard auth checks and force `isPasswordRecovery`.
