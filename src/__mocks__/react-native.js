/* global jest */
module.exports = {
  Platform: {
    OS: 'web',
    select: (obj) => obj.web || obj.default,
  },
  useColorScheme: jest.fn(() => 'dark'),
  useWindowDimensions: jest.fn(() => ({ width: 375, height: 812, scale: 1, fontScale: 1 })),
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
  Animated: {
    Value: jest.fn(function (val) {
      this.val = val;
      this.setValue = jest.fn((v) => { this.val = v; });
      this.interpolate = jest.fn(() => 0);
    }),
    timing: jest.fn(() => ({
      start: jest.fn((cb) => cb && cb({ finished: true })),
    })),
    sequence: jest.fn(() => ({
      start: jest.fn((cb) => cb && cb({ finished: true })),
    })),
    parallel: jest.fn(() => ({
      start: jest.fn((cb) => cb && cb({ finished: true })),
    })),
    View: 'Animated.View',
    Text: 'Animated.Text',
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
  FlatList: 'FlatList',
  Image: 'Image',
  Share: {
    share: jest.fn(() => Promise.resolve()),
  },
  StatusBar: () => null,
};
