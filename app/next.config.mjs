/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // for the infra/frontend.Dockerfile multi-stage build
  webpack: (config) => {
    // wagmi/viem pull in optional pretty-printers; silence the harmless warnings.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  // Baseline security headers (clickjacking, MIME sniffing, referrer/permissions).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
