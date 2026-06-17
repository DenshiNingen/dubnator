import Nav from "@/components/sections/Nav";
import Hero from "@/components/sections/Hero";
import Features from "@/components/sections/Features";
import ForTheDance from "@/components/sections/ForTheDance";
import LiveDemo from "@/components/sections/LiveDemo";
import Download from "@/components/sections/Download";
import Faq from "@/components/sections/Faq";
import Footer from "@/components/sections/Footer";

export default function Page() {
  return (
    <main>
      <Nav />
      <Hero />
      <Features />
      <ForTheDance />
      <LiveDemo />
      <Download />
      <Faq />
      <Footer />
    </main>
  );
}
