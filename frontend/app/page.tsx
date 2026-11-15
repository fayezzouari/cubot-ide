import Header from '@/components/header';
import HeroSection from '@/components/hero-section';
import WorkflowSection from '@/components/workflow-section';
import FeaturesSection from '@/components/features-section';
import CTASection from '@/components/cta-section';
import Footer from '@/components/footer';
import SectionJourney from '@/components/section-journey';
import PixelSnow from '@/components/PixelSnow';

export default function Home() {
  return (
    <main className="bg-well text-ink font-sans relative">

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
        <SectionJourney
          stops={[
            { label: 'Workflow', content: <WorkflowSection /> },
            { label: 'Features', anchor: 'features', content: <FeaturesSection /> },
            { label: 'Get started', anchor: 'github', content: <CTASection /> },
          ]}
        />
        <Footer />
      </div>
    </main>
  );
}
