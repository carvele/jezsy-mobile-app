import Constants from 'expo-constants';
import { supabase } from '@/src/lib/supabase';
import { formatTimeLabel } from '@/src/utils/dateTime';

// Detect if running inside Expo Go.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (IS_EXPO_GO) {
    console.log('Push notifications skipped: running in Expo Go.');
    return null;
  }

  // Lazily import native modules so they never load in Expo Go.
  const { default: Device } = await import('expo-device');
  const Notifications = await import('expo-notifications');
  const { Platform } = await import('react-native');

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C9A96E',
    });
  }

  if (!Device.isDevice) {
    console.log('Must use physical device for Push Notifications');
    return null;
  }

  const permission = (await Notifications.getPermissionsAsync()) as any;
  let finalStatus = permission.status;

  if (finalStatus !== 'granted') {
    const request = (await Notifications.requestPermissionsAsync()) as any;
    finalStatus = request.status;
  }

  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return null;
  }

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    if (!projectId) throw new Error('Project ID not found');

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (e) {
    console.log('Error getting push token: ', e);
    return null;
  }
}

export async function savePushTokenToProfile(userId: string): Promise<void> {
  if (IS_EXPO_GO) return;
  try {
    const token = await registerForPushNotificationsAsync();
    if (token) {
      await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', userId);
    }
  } catch (error) {
    console.error('Error saving push token to profile:', error);
  }
}

export async function scheduleReservationReminder(displayId: string, appointmentDate: string, timeStr: string): Promise<void> {
  if (IS_EXPO_GO) {
    console.log('Skipping push notification scheduling in Expo Go.');
    return;
  }

  try {
    const Notifications = await import('expo-notifications');
    
    const time24Match = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    const time12Match = timeStr.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
    if (!time24Match && !time12Match) return;

    let hours = Number((time24Match || time12Match)![1]);
    const minutes = Number((time24Match || time12Match)![2]);

    if (time12Match) {
      const isPM = time12Match[3].toUpperCase() === 'PM';
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }

    const dateParts = appointmentDate.split('T')[0].split('-').map(Number);
    const targetDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, minutes, 0, 0);
    const timeLabel = formatTimeLabel(timeStr);
    
    // Set reminder for 24 hours before the appointment
    const reminderDate = new Date(targetDate.getTime() - (24 * 60 * 60 * 1000));
    
    if (reminderDate > new Date()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Upcoming Fitting Appointment",
          body: `Your reservation (${displayId}) is tomorrow at ${timeLabel}. We look forward to seeing you!`,
          data: { displayId },
        },
        trigger: {
          seconds: Math.floor((reminderDate.getTime() - Date.now()) / 1000),
        } as any,
      });
      console.log(`Scheduled reminder for ${displayId} at ${reminderDate.toISOString()}`);
    } else {
      console.log('Appointment is in less than 24 hours. Skipping reminder.');
    }
  } catch (error) {
    console.error('Error scheduling reservation reminder:', error);
  }
}
