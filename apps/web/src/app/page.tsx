import Image from "next/image";
import Link from "next/link";
import { latestRelease } from "@moonsnap/changelog";
import { getLatestReleaseVersion, getWindowsInstallerDownloadUrl } from "@/lib/releaseData";
import {
  RecordIcon,
  ScreenshotIcon,
  GifIcon,
  WebcamIcon,
  EditIcon,
  SparklesIcon,
  DownloadIcon,
  WindowsIcon,
  PlayIcon,
  CheckIcon,
  CrossIcon,
  CrownIcon,
} from "./icons";

const POLAR_CHECKOUT_URL =
  "https://buy.polar.sh/polar_cl_WDZB2ld3wEqqWTOustdiNZHASOHMOz4lxlsZ03VjJfx";

export default async function Home() {
  const latestVersion = await getLatestReleaseVersion();
  const fallbackVersion = latestRelease?.version ?? null;
  const displayVersion = latestVersion ?? fallbackVersion;
  const downloadUrl =
    getWindowsInstallerDownloadUrl(displayVersion) ??
    "https://github.com/moonsnapapp/moonsnap/releases/latest";

  return (
    <div className="relative min-h-screen">
      {/* Background effects */}
      <div className="fixed inset-0 grid-pattern pointer-events-none" />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 77, 77, 0.12) 0%, transparent 50%)",
        }}
      />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--background)]/50 backdrop-blur-sm border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/app-icon.png"
              alt="MoonSnap"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-sora)" }}
            >
              MoonSnap
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#features"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Pricing
            </a>
            <Link
              href="/changelog"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Changelog
            </Link>
            <a
              href="#download"
              className="btn-primary text-sm px-4 py-2"
            >
              Download
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            {/* Main headline */}
            <h1
              className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6 animate-slide-up opacity-0 delay-100"
              style={{ fontFamily: "var(--font-sora)" }}
            >
              <span className="gradient-text">Screen capture</span>
              <br />
              <span className="text-[var(--accent)] text-glow">
                made beautiful
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg sm:text-xl text-[var(--muted)] max-w-2xl mx-auto mb-10 animate-slide-up opacity-0 delay-200">
              Record your screen, capture screenshots, and create stunning GIFs.
              <br className="hidden sm:block" />
              The most elegant recording tool for Windows.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-slide-up opacity-0 delay-300">
              <a href="#download" className="btn-primary flex items-center gap-2">
                <DownloadIcon className="w-5 h-5" />
                Start Free Trial
              </a>
              <a href="#pricing" className="btn-secondary flex items-center gap-2">
                <CrownIcon className="w-5 h-5 text-[var(--accent)]" />
                See Pricing
              </a>
            </div>

            <p className="text-sm text-[var(--muted)] mb-16 animate-slide-up opacity-0 delay-300">
              7-day free trial &middot; All features unlocked &middot; No account required
            </p>

            {/* Hero screenshot */}
            <div className="relative animate-scale-in opacity-0 delay-400">
              {/* Glow behind */}
              <div className="absolute inset-0 blur-3xl opacity-30 bg-gradient-to-b from-[var(--accent)] to-transparent" />

              <div className="relative animate-float rounded-xl overflow-hidden border border-[var(--border)] shadow-2xl">
                <Image
                  src="/cover.png"
                  alt="MoonSnap Library"
                  width={1920}
                  height={1080}
                  className="w-full h-auto"
                  priority
                />
              </div>

              <div className="relative mt-6 mx-auto max-w-2xl animate-float" style={{ animationDelay: "0.5s" }}>
                <Image
                  src="/capture-bar.png"
                  alt="MoonSnap Capture Bar"
                  width={736}
                  height={110}
                  className="w-full h-auto rounded-lg border border-[var(--border)] shadow-xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2
              className="text-3xl sm:text-4xl font-bold tracking-tight mb-4"
              style={{ fontFamily: "var(--font-sora)" }}
            >
              Everything you need to
              <br />
              <span className="text-[var(--accent)]">capture & create</span>
            </h2>
            <p className="text-[var(--muted)] max-w-xl mx-auto">
              Professional-grade tools wrapped in an intuitive interface.
              <br />
              No learning curve, just results.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="feature-card rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-auto"
              >
                <source src="/screen-capture.mp4" type="video/mp4" />
              </video>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <RecordIcon className="w-6 h-6" />
                  </div>
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  Screen Recording
                </h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  Record your entire screen, a window, or a custom region. Crystal clear quality at up to 60fps.
                </p>
              </div>
            </div>
            <div className="feature-card rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-auto"
              >
                <source src="/image-editor.mp4" type="video/mp4" />
              </video>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <ScreenshotIcon className="w-6 h-6" />
                  </div>
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  Screenshots
                </h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  Capture any part of your screen instantly. Annotate, blur, and highlight with built-in tools.
                </p>
              </div>
            </div>
            <div className="feature-card rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <Image
                src="/gif-capture.gif"
                alt="GIF recording demo"
                width={600}
                height={338}
                className="w-full h-auto"
                unoptimized
              />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <GifIcon className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                    Pro
                  </span>
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  GIF Recording
                </h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  Turn your captures into GIFs. Optimized for sharing anywhere.
                </p>
              </div>
            </div>
            <div className="feature-card rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <Image
                src="/webcam.png"
                alt="Webcam overlay demo"
                width={600}
                height={338}
                className="w-full h-auto"
              />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <WebcamIcon className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                    Pro
                  </span>
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  Webcam Overlay
                </h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  Add your face to recordings with customizable webcam overlays. Perfect for tutorials.
                </p>
              </div>
            </div>
            <div className="feature-card rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <Image
                src="/video-editor.png"
                alt="Video editor demo"
                width={600}
                height={338}
                className="w-full h-auto"
              />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <EditIcon className="w-6 h-6" />
                  </div>
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  Video Editor
                </h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  Trim, cut, and polish your recordings. Add captions, zoom effects, and custom backgrounds.
                </p>
              </div>
            </div>
            <div className="feature-card rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
              <video
                autoPlay
                loop
                muted
                playsInline
                controls
                className="w-full h-auto"
              >
                <source src="/captions.mp4" type="video/mp4" />
              </video>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                    <SparklesIcon className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                    Pro
                  </span>
                </div>
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  Auto Captions
                </h3>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  AI-powered captions generated locally. No cloud upload, complete privacy.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Showcase Section */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--accent)]/5 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2
                className="text-3xl sm:text-4xl font-bold tracking-tight mb-6"
                style={{ fontFamily: "var(--font-sora)" }}
              >
                Designed for
                <br />
                <span className="text-[var(--accent)]">professionals</span>
              </h2>
              <p className="text-[var(--muted)] mb-8 text-lg">
                Whether you&apos;re creating tutorials, recording bug reports,
                or sharing product demos — MoonSnap gives you the tools to make
                every capture look polished.
              </p>
              <ul className="space-y-4">
                {[
                  "Hardware-accelerated recording",
                  "System & microphone audio capture",
                  "Custom keyboard shortcuts",
                  "Automatic cursor highlighting",
                  "Export to MP4, WebM, or GIF",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
                      <CheckIcon className="w-3 h-3 text-[var(--accent)]" />
                    </div>
                    <span className="text-[var(--foreground)]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 blur-3xl opacity-20 bg-[var(--accent)] rounded-3xl" />
              <div className="relative window-mockup">
                <div className="window-titlebar">
                  <div className="window-dot bg-[#ff5f57]" />
                  <div className="window-dot bg-[#febc2e]" />
                  <div className="window-dot bg-[#28c840]" />
                  <span className="ml-4 text-xs text-[var(--muted)]">
                    Video Editor
                  </span>
                </div>
                <div className="aspect-video bg-[var(--surface)] p-4">
                  <div className="h-full flex flex-col gap-3">
                    <div className="flex-1 rounded-lg bg-[var(--background)] border border-[var(--border)] flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
                        <PlayIcon className="w-8 h-8 text-[var(--accent)]" />
                      </div>
                    </div>
                    <div className="h-16 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] p-2">
                      <div className="h-full flex gap-1">
                        {[65, 45, 80, 35, 70, 55, 90, 40, 75, 50, 85, 38, 72, 48, 88, 42, 78, 52, 68, 58].map((h, i) => (
                          <div
                            key={i}
                            className="flex-1 rounded bg-[var(--accent)]/30"
                            style={{
                              height: `${h}%`,
                              alignSelf: "flex-end",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6 relative">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(255, 77, 77, 0.06) 0%, transparent 60%)",
        }} />
        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-16">
            <h2
              className="text-3xl sm:text-4xl font-bold tracking-tight mb-4"
              style={{ fontFamily: "var(--font-sora)" }}
            >
              Simple, <span className="text-[var(--accent)]">honest</span> pricing
            </h2>
            <p className="text-[var(--muted)] max-w-xl mx-auto">
              Try everything free for 7 days. Then choose the plan that works for you.
              <br />
              One-time purchase — no subscriptions, no recurring fees.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Free Plan */}
            <div className="pricing-card p-8 rounded-2xl bg-[var(--surface)] border border-[var(--border)]">
              <div className="mb-6">
                <h3
                  className="text-xl font-semibold mb-1"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  Free
                </h3>
                <p className="text-sm text-[var(--muted)]">After trial ends</p>
              </div>
              <div className="mb-8">
                <span
                  className="text-4xl font-bold tracking-tight"
                  style={{ fontFamily: "var(--font-sora)" }}
                >
                  $0
                </span>
                <span className="text-[var(--muted)] ml-1">forever</span>
              </div>
              <ul className="space-y-3 mb-8">
                <PricingFeature included>Screenshots</PricingFeature>
                <PricingFeature included>Annotations</PricingFeature>
                <PricingFeature included>Screen recording</PricingFeature>
                <PricingFeature>Video export</PricingFeature>
                <PricingFeature>GIF export</PricingFeature>
                <PricingFeature>Auto captions</PricingFeature>
                <PricingFeature>Webcam overlay</PricingFeature>
                <PricingFeature>Custom backgrounds</PricingFeature>
              </ul>
              <a
                href="#download"
                className="btn-secondary block text-center text-sm"
              >
                Download
              </a>
            </div>

            {/* Pro Plan */}
            <div className="pricing-card pricing-card-pro p-8 rounded-2xl bg-[var(--surface)] border-2 border-[var(--accent)]/40 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
              <div className="absolute -top-24 -right-24 w-48 h-48 rounded-full bg-[var(--accent)]/8 blur-3xl" />
              <div className="relative">
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3
                      className="text-xl font-semibold mb-1 flex items-center gap-2"
                      style={{ fontFamily: "var(--font-sora)" }}
                    >
                      Pro
                      <span className="text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/20">
                        Popular
                      </span>
                    </h3>
                    <p className="text-sm text-[var(--muted)]">One-time purchase</p>
                  </div>
                </div>
                <div className="mb-8">
                  <span
                    className="text-4xl font-bold tracking-tight"
                    style={{ fontFamily: "var(--font-sora)" }}
                  >
                    $29
                  </span>
                  <span className="text-[var(--muted)] ml-1">one-time</span>
                </div>
                <ul className="space-y-3 mb-8">
                  <PricingFeature included>Screenshots</PricingFeature>
                  <PricingFeature included>Annotations</PricingFeature>
                  <PricingFeature included>Screen recording</PricingFeature>
                  <PricingFeature included>Video export</PricingFeature>
                  <PricingFeature included>GIF export</PricingFeature>
                  <PricingFeature included>Auto captions</PricingFeature>
                  <PricingFeature included>Webcam overlay</PricingFeature>
                  <PricingFeature included>Custom backgrounds</PricingFeature>
                </ul>
                <a
                  href={POLAR_CHECKOUT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary block text-center text-sm"
                >
                  Buy MoonSnap Pro
                </a>
                <p className="text-xs text-[var(--muted)] text-center mt-3">
                  Covers all v1.x updates
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Download Section */}
      <section id="download" className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2
            className="text-3xl sm:text-4xl font-bold tracking-tight mb-6"
            style={{ fontFamily: "var(--font-sora)" }}
          >
            Ready to start capturing?
          </h2>
          <p className="text-[var(--muted)] mb-10 text-lg">
            Download MoonSnap and try every feature free for 7 days.
            <br />
            No account required. No credit card.
          </p>

          <div className="inline-flex flex-col items-center gap-4">
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary flex items-center gap-3 text-lg px-8 py-4"
            >
              <WindowsIcon className="w-6 h-6" />
              Download for Windows
            </a>
            <span className="text-sm text-[var(--muted)]">
              {displayVersion ? `Version ${displayVersion} · Windows 10/11` : "Windows 10/11"}
            </span>
          </div>

          <div className="mt-16 pt-16 border-t border-[var(--border)]">
            <p className="text-sm text-[var(--muted)]">
              7-day free trial · No account required · One-time purchase
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-[var(--border)]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/app-icon.png"
              alt="MoonSnap"
              width={24}
              height={24}
              className="rounded-md"
            />
            <span className="text-sm text-[var(--muted)]">
              MoonSnap &copy; {new Date().getFullYear()}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#features"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Pricing
            </a>
            <a
              href="#download"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Download
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PricingFeature({
  children,
  included,
}: {
  children: React.ReactNode;
  included?: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      {included ? (
        <div className="w-5 h-5 rounded-full bg-[var(--accent)]/20 flex items-center justify-center flex-shrink-0">
          <CheckIcon className="w-3 h-3 text-[var(--accent)]" />
        </div>
      ) : (
        <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
          <CrossIcon className="w-3 h-3 text-[var(--muted)]/50" />
        </div>
      )}
      <span className={included ? "text-sm text-[var(--foreground)]" : "text-sm text-[var(--muted)]"}>
        {children}
      </span>
    </li>
  );
}
