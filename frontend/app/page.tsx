import Header from '@/components/header';
import HeroSection from '@/components/hero-section';
import AboutSection from '@/components/about-section';
import FeaturesSection from '@/components/features-section';
import CTASection from '@/components/cta-section';
import Footer from '@/components/footer';
import PixelSnow from '@/components/PixelSnow';

export default function Home() {
  return (
    <main className="bg-background text-foreground font-sans relative overflow-hidden">
      {/* PixelSnow background effect */}
      <div style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
      }}>
        <PixelSnow
          color="#ffffff"
          flakeSize={0.003}
          minFlakeSize={1}
          pixelResolution={375}
          speed={0.85}
          depthFade={5}
          farPlane={15}
          brightness={1}
          gamma={0.4545}
          density={0.7}
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
