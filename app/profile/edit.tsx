import ProfileSetupScreen from '@/app/(auth)/profile-setup';

// The setup wizard doubles as the profile editor, but it cannot be reached at
// its own path once the profile is complete: the routing gate in
// app/_layout.tsx redirects any set-up user out of the (auth) group, which is
// what made Edit open a blank screen and bounce straight back. Rendering the
// same screen from a route outside that group sidesteps the gate entirely.
export default function EditProfileScreen() {
  return <ProfileSetupScreen mode="edit" />;
}
