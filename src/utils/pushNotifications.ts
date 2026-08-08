import { supabase } from "@/src/lib/supabase";
import { formatTimeLabel } from "@/src/utils/dateTime";
import Constants from "expo-constants";

// Detect if running inside Expo Go.
const IS_EXPO_GO = Constants.appOwnership === "expo";

// Discriminated rather than `string | null` so the settings toggle can say why
// registration failed. It previously reported every failure as a permission or
// emulator problem, which hid the fact that the EAS projectId is missing.
export type PushRegistration =
  | { status: "ok"; token: string }
  | { status: "expo-go" }
  | { status: "no-device" }
  | { status: "denied" }
  | { status: "not-configured" }
  | { status: "error"; message: string };

export async function registerForPushNotificationsAsync(): Promise<PushRegistration> {
  if (IS_EXPO_GO) {
    console.log("Push notifications skipped: running in Expo Go.");
    return { status: "expo-go" };
  }

  let Device: any;
  let Notifications: any;
  let Platform: any;

  // Everything below touches native modules (notification channels, device
  // info, permissions). None of it may ever be allowed to throw out of this
  // function: it runs fire-and-forget from the login/session-sync path, and
  // an uncaught rejection there must never be able to block or degrade login.
  try {
    // Lazily import native modules so they never load in Expo Go.
    // expo-device has no default export -- isDevice/deviceName/modelName are
    // named exports on the module namespace itself. Reading `.default` here
    // was always undefined, which silently misreported every physical
    // device as "no-device" (undefined is falsy) instead of registering it.
    Device = await import("expo-device");
    Notifications = await import("expo-notifications");
    const rnModule = await import("react-native");
    Platform = rnModule.Platform;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#C9A96E",
      });
    }

    // Guard: Device module may be undefined if import failed unexpectedly
    if (!Device || !Device.isDevice) {
      console.log("Must use physical device for Push Notifications");
      return { status: "no-device" };
    }

    const permission = (await Notifications.getPermissionsAsync()) as any;
    let finalStatus = permission.status;

    if (finalStatus !== "granted") {
      const request = (await Notifications.requestPermissionsAsync()) as any;
      finalStatus = request.status;
    }

    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification!");
      return { status: "denied" };
    }

    // Not present in app.json or eas.json today, so this is the branch that
    // actually fires. It is a configuration gap, not a runtime failure: an Expo
    // push token cannot be minted without it, and notify-status sends through
    // Expo's push API so a bare FCM device token would not do. Run `eas init`
    // (or copy the id from expo.dev) into expo.extra.eas.projectId.
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    if (!projectId) {
      console.log(
        "Push notifications not configured: expo.extra.eas.projectId is missing.",
      );
      return { status: "not-configured" };
    }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: "ok", token: data };
  } catch (e: any) {
    console.log("Push notification registration failed (non-fatal):", e);
    return { status: "error", message: e?.message ?? "Unknown error" };
  }
}

const pushRegistrationPromises = new Map<string, Promise<PushRegistration>>();

// Returns the outcome so a caller that is a user-facing toggle can explain
// itself. Still never throws: it also runs fire-and-forget from the login path,
// where an unhandled rejection must not be able to degrade sign-in.
export async function savePushTokenToProfile(userId: string): Promise<PushRegistration> {
  if (IS_EXPO_GO) return { status: "expo-go" };

  const existingPromise = pushRegistrationPromises.get(userId);
  if (existingPromise) {
    return existingPromise;
  }

  const savePromise = (async (): Promise<PushRegistration> => {
    try {
      const result = await registerForPushNotificationsAsync();
      if (result.status === "ok") {
        const { error } = await supabase
          .from("profiles")
          .update({ expo_push_token: result.token })
          .eq("id", userId);
        if (error) return { status: "error", message: error.message };
      }
      return result;
    } catch (error: any) {
      console.error("Error saving push token to profile:", error);
      return { status: "error", message: error?.message ?? "Unknown error" };
    }
  })();

  pushRegistrationPromises.set(userId, savePromise);
  try {
    return await savePromise;
  } finally {
    pushRegistrationPromises.delete(userId);
  }
}

export async function scheduleReservationReminder(
  displayId: string,
  appointmentDate: string,
  timeStr: string,
): Promise<void> {
  if (IS_EXPO_GO) {
    console.log("Skipping push notification scheduling in Expo Go.");
    return;
  }

  try {
    const Notifications = await import("expo-notifications");

    const time24Match = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    const time12Match = timeStr.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
    if (!time24Match && !time12Match) return;

    let hours = Number((time24Match || time12Match)![1]);
    const minutes = Number((time24Match || time12Match)![2]);

    if (time12Match) {
      const meridiem = time12Match[3].toUpperCase();
      if (meridiem === "PM" && hours < 12) hours += 12;
      if (meridiem === "AM" && hours === 12) hours = 0;
    }

    const appointmentDateTime = new Date(appointmentDate);
    appointmentDateTime.setHours(hours, minutes, 0, 0);

    const reminderTime = new Date(
      appointmentDateTime.getTime() - 60 * 60 * 1000,
    );
    if (reminderTime <= new Date()) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Upcoming Reservation Reminder",
        body: `Your reservation #${displayId} is in 1 hour at ${formatTimeLabel(timeStr)}.`,
        sound: true,
        data: { displayId, appointmentDate, timeStr },
      },
      trigger: { type: "date", date: reminderTime } as any,
    });
  } catch (e) {
    console.error("Error scheduling reservation reminder:", e);
  }
}
