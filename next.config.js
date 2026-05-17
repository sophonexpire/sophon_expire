/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure the server runtime resolves chunks from `.next/server/chunks/*`.
      // This avoids "Cannot find module './<id>.js'" when chunk files are emitted under `chunks/`.
      config.output.chunkFilename = "chunks/[id].js";
    }
    return config;
  }
};

module.exports = nextConfig;
