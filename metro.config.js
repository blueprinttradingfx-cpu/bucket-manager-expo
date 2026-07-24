// metro.config.js
// Defensive fix for a known Firebase JS SDK / Metro bundling incompatibility:
// Firebase's package.json "exports" field resolves to a build that breaks
// under Metro's package-exports resolution (surfaces as errors like
// "Component auth has not been registered yet"). Expo SDK 52 defaults
// unstable_enablePackageExports to false, so this is a no-op today - but
// SDK 53+ flips that default to true, which would silently reintroduce the
// bug on the next SDK upgrade if this isn't explicit.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
