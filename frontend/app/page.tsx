import Header from '@/components/header';
import HeroSection from '@/components/hero-section';
import AboutSection from '@/components/about-section';
import FeaturesSection from '@/components/features-section';
import CTASection from '@/components/cta-section';
import Footer from '@/components/footer';
import PixelSnow from '@/components/PixelSnow';

export default function Home() {
  return (
    <main className="bg-background text-foreground font-sans relative">
      {/* Subtle particle background on hero only */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '40vh',
          zIndex: 0,
          pointerEvents: 'none',
          opacity: 0.4,
        }}
      >
        <PixelSnow
          color="#3b82f6"
          flakeSize={0.002}
          minFlakeSize={1}
          pixelResolution={500}
          speed={0.5}
          depthFade={8}
          farPlane={20}
          brightness={0.7}
          gamma={0.4545}
          density={0.4}
          variant="square"
          direction={90}
        />
      </div>
      <div className="relative z-10">
        <Header />
        <HeroSection />
        <AboutSection />
        <FeaturesSection />
        <CTASection />
        <Footer />
      </div>
    </main>
  );
}
