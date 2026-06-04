const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle all binary assets for offline operation — no CDN needed
config.resolver.assetExts.push(
  'tflite',  // MobileFaceNet INT8 model
  'task',    // MediaPipe face landmark model
  'bin',
  'ort',
  'html',    // MediaPipe WebView bridge
  'wasm',    // MediaPipe WASM runtime (offline)
  'mjs',     // MediaPipe JS bundle (offline)
);

config.resolver.sourceExts = ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs'];

module.exports = config;
