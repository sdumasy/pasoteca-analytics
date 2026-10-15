/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server for the container Cloud Run runs.
  output: "standalone",
  experimental: { serverComponentsExternalPackages: ["@google-cloud/bigquery", "firebase-admin"] },
};
export default nextConfig;
