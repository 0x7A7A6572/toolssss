module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/screenshots.html',
    './src/renderer/src/**/*.{vue,js,ts,jsx,tsx}',
    './experiment/**/*.{vue,js,ts,jsx,tsx}',
    './landing-web/**/*.{html,vue,js,ts}'
  ],
  theme: {
    extend: {}
  },
  plugins: [],
  corePlugins: {
    preflight: false
  }
}
