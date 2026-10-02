import type { Metadata } from 'next';

const title = 'AgentReady — Is Your Business Ready for AI Agents?';
const description = 'Check how easily AI agents can understand, find, and act on your business website. Get an evidence-based readiness score and clear recommendations.';
const image = '/agentready-social.png';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'AgentReady by Myric',
    url: '/',
    title,
    description,
    images: [{
      url: image,
      width: 1200,
      height: 630,
      alt: 'AgentReady Research Preview — Is your business ready for AI agents?',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [image],
  },
};

export default function HomeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
