/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // for the infra/frontend.Dockerfile multi-stage build
  webpack: (config) => {
    // wagmi/viem pull in optional pretty-printers; silence the harmless warnings.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
