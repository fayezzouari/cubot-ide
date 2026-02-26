import Header from '@/components/header';
import HeroSection from '@/components/hero-section';
import DemoSection from '@/components/demo-section';
import AboutSection from '@/components/about-section';
import WorkflowSection from '@/components/workflow-section';
import FeaturesSection from '@/components/features-section';
import CTASection from '@/components/cta-section';
import Footer from '@/components/footer';
import PixelSnow from '@/components/PixelSnow';

export default function Home() {
  return (
    <main className="bg-black text-foreground font-sans relative">
      {/* Dot grid */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />

      {/* Particle effect */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '50vh',
          zIndex: 0,
          pointerEvents: 'none',
          opacity: 0.3,
        }}
      >
        <PixelSnow
          color="#ffffff"
          flakeSize={0.002}
          minFlakeSize={1}
          pixelResolution={500}
          speed={0.4}
          depthFade={8}
          farPlane={20}
          brightness={0.6}
          gamma={0.4545}
          density={0.35}
          variant="square"
          direction={90}
        />
      </div>

      <div className="relative z-10">
        <Header />
        <HeroSection />
        <DemoSection />
        <AboutSection />
        <WorkflowSection />
        <FeaturesSection />
        <CTASection />
        <Footer />
      </div>
    </main>
  );
}
