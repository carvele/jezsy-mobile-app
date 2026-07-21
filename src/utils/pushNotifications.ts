import { supabase } from "@/src/lib/supabase";
import { formatTimeLabel } from "@/src/utils/dateTime";
import Constants from "expo-constants";

// Detect if running inside Expo Go.
const IS_EXPO_GO = Constants.appOwnership === "expo";

export async function registerForPushNotificationsAsync(): Promise<
  string | null
> {
  if (IS_EXPO_GO) {
    console.log("Push notifications skipped: running in Expo Go.");
    return null;
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
    const deviceModule = await import("expo-device");
    Device = deviceModule.default;
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
      return null;
    }

    const permission = (await Notifications.getPermissionsAsync()) as any;
    let finalStatus = permission.status;

    if (finalStatus !== "granted") {
      const request = (await Notifications.requestPermissionsAsync()) as any;
      finalStatus = request.status;
    }

    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification!");
      return null;
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    if (!projectId) throw new Error("Project ID not found");

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (e) {
    console.log("Push notification registration failed (non-fatal):", e);
    return null;
  }
}

const pushRegistrationPromises = new Map<string, Promise<void>>();

export async function savePushTokenToProfile(userId: string): Promise<void> {
  if (IS_EXPO_GO) return;

  const existingPromise = pushRegistrationPromises.get(userId);
  if (existingPromise) {
    return existingPromise;
  }

  const savePromise = (async () => {
    try {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        await supabase
          .from("profiles")
          .update({ expo_push_token: token })
          .eq("id", userId);
      }
    } catch (error) {
      console.error("Error saving push token to profile:", error);
    }
  })();

  pushRegistrationPromises.set(userId, savePromise);
  try {
    await savePromise;
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
