/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The foundation ships no runtime secrets. Any future server config must stay
  // server-only — never expose secrets via NEXT_PUBLIC_*.
};

export default nextConfig;
