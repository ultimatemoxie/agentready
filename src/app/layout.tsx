import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://agentready-ecru.vercel.app'),
  title: 'AgentReady by Myric — Business readiness for AI agents',
  description: 'An experimental research diagnostic for how clearly AI agents can discover, understand and act on a public business website.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
