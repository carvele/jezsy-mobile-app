/* global jest */
module.exports = {
  Platform: {
    OS: 'web',
    select: (obj) => obj.web || obj.default,
  },
  useColorScheme: jest.fn(() => 'dark'),
  AccessibilityInfo: {
    isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Linking: {
    openSettings: jest.fn(() => Promise.resolve()),
  },
  StyleSheet: {
    create: (s) => s,
    absoluteFill: {},
  },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  Modal: 'Modal',
  ActivityIndicator: 'ActivityIndicator',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Dimensions: {
    get: jest.fn(() => ({ width: 375, height: 812 })),
  },
  Alert: {
    alert: jest.fn(),
  },
};
