module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@hooks': './src/hooks',
            '@utils': './src/utils',
            '@services': './src/services',
            '@store': './src/store',
            '@components': './src/components',
            // Added: config and database aliases required by new files
            '@config': './src/config',
            '@database': './src/database',
          },
        },
      ],
      // react-native-reanimated/plugin MUST remain the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
