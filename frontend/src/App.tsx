import Header from '@/components/header'
import HeroSection from '@/components/hero-section'
import AboutSection from '@/components/about-section'
import FeaturesSection from '@/components/features-section'
import CTASection from '@/components/cta-section'
import Footer from '@/components/footer'

export default function App() {
  return (
    <main className="bg-background text-foreground font-sans">
      <Header />
      <HeroSection />
      <AboutSection />
      <FeaturesSection />
      <CTASection />
      <Footer />
    </main>
  )
}
