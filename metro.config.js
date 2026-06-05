const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle ML model files and bridge HTML as assets
config.resolver.assetExts.push('tflite', 'task', 'bin', 'ort', 'html', 'wasm');

config.resolver.sourceExts = ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs'];

module.exports = config;
