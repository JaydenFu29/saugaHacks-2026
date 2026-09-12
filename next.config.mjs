/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // The presentation site is static under public/site/.
      { source: "/site", destination: "/site/index.html", permanent: false },
      { source: "/site/", destination: "/site/index.html", permanent: false },
      // The old hand-rolled server served the app at /web/; keep those links working.
      { source: "/web", destination: "/", permanent: false },
      { source: "/web/", destination: "/", permanent: false },
      { source: "/web/index.html", destination: "/", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // getUserMedia is blocked without this on some embedded/proxied contexts.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
