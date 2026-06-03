const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow bundling TFLite models, MediaPipe task files, and the WebView bridge HTML
config.resolver.assetExts.push('tflite', 'task', 'bin', 'ort', 'html');

// Module resolution for reanimated + skia
config.resolver.sourceExts = ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs'];

module.exports = config;
