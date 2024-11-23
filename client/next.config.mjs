/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Enables React's strict mode
  swcMinify: true, // Uses SWC compiler for faster builds and smaller bundles

  // Webpack configuration
  webpack: (config, { isServer }) => {
    // If you have any specific client-side code that references 'fs' or other Node.js modules, ensure it's handled correctly
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, // Prevent fs from causing build issues in client-side code
      };
    }

    // Optionally disable HMR to avoid the errors you encountered
    config.optimization.runtimeChunk = false;

    return config;
  },

  // Experimental features (optional, based on your needs)
  experimental: {
    appDir: true, // Enable the app directory (if using Next.js 13+)
  },

  // Turn off the automatic static optimization for development
  devIndicators: {
    autoPrerender: false,
  },
};

export default nextConfig;
