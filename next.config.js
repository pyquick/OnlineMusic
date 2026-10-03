/**
 * The server build (`output: "standalone"`) is the Docker deployment. `NEXT_EXPORT=1` switches to
 * a fully static export of the UI alone (the API routes are excluded), which is what the desktop
 * .app bundles and what a separately-hosted client serves: `npm run build:client` → `out/`.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: process.env.NEXT_EXPORT === "1" ? "export" : "standalone",
};

module.exports = nextConfig;
