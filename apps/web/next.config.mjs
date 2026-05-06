/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@meeting-ai-kit/shared",
    "@meeting-ai-kit/visual-renderer"
  ]
};

export default nextConfig;
