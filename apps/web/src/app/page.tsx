import Link from "next/link";
import { latestRelease } from "@snapit/changelog";
import { getLatestReleaseVersion } from "@/lib/releaseData";
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
} from "./icons";

export default async function Home() {
  const latestVersion = await getLatestReleaseVersion();
  const fallbackVersion = latestRelease?.version ?? null;
  const displayVersion = latestVersion ?? fallbackVersion;

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
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center glow-red">
              <RecordIcon className="w-4 h-4 text-white" />
            </div>
            <span
              className="text-lg font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-sora)" }}
            >
              SnapIt
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#features"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Features
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

            {/* CTA Button */}
            <div className="flex items-center justify-center mb-16 animate-slide-up opacity-0 delay-300">
              <a href="#download" className="btn-primary flex items-center gap-2">
                <DownloadIcon className="w-5 h-5" />
                Download for Windows
              </a>
            </div>

            {/* Hero mockup */}
            <div className="relative animate-scale-in opacity-0 delay-400">
              {/* Glow behind */}
              <div className="absolute inset-0 blur-3xl opacity-30 bg-gradient-to-b from-[var(--accent)] to-transparent" />

              <div className="relative window-mockup animate-float">
                <div className="window-titlebar">
                  <div className="window-dot bg-[#ff5f57]" />
                  <div className="window-dot bg-[#febc2e]" />
                  <div className="window-dot bg-[#28c840]" />
                  <span className="ml-4 text-xs text-[var(--muted)]">
                    SnapIt Library
                  </span>
                </div>
                <div className="relative aspect-video bg-gradient-to-br from-[var(--surface)] to-[var(--background)]">
                  {/* Simulated UI */}
                  <div className="absolute inset-4 flex gap-4">
                    {/* Sidebar */}
                    <div className="w-48 space-y-3">
                      <div className="h-10 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)]" />
                      <div className="space-y-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className="h-8 rounded-md bg-[var(--surface-elevated)]/50"
                          />
                        ))}
                      </div>
                    </div>
                    {/* Content grid */}
                    <div className="flex-1 grid grid-cols-3 gap-3">
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div
                          key={i}
                          className="aspect-video rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center"
                        >
                          {i === 1 && (
                            <div className="w-10 h-10 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
                              <PlayIcon className="w-5 h-5 text-[var(--accent)]" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Recording indicator */}
                  <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent)]/20 border border-[var(--accent)]/30">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-recording" />
                    <span className="text-xs font-medium text-[var(--accent)]">
                      REC 00:42
                    </span>
                  </div>
                </div>
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
            <FeatureCard
              icon={<RecordIcon className="w-6 h-6" />}
              title="Screen Recording"
              description="Record your entire screen, a window, or a custom region. Crystal clear quality at up to 60fps."
            />
            <FeatureCard
              icon={<ScreenshotIcon className="w-6 h-6" />}
              title="Screenshots"
              description="Capture any part of your screen instantly. Annotate, blur, and highlight with built-in tools."
            />
            <FeatureCard
              icon={<GifIcon className="w-6 h-6" />}
              title="GIF Creation"
              description="Turn any recording into a perfectly looped GIF. Optimized for sharing anywhere."
            />
            <FeatureCard
              icon={<WebcamIcon className="w-6 h-6" />}
              title="Webcam Overlay"
              description="Add your face to recordings with customizable webcam overlays. Perfect for tutorials."
            />
            <FeatureCard
              icon={<EditIcon className="w-6 h-6" />}
              title="Video Editor"
              description="Trim, cut, and polish your recordings. Add captions, zoom effects, and custom backgrounds."
            />
            <FeatureCard
              icon={<SparklesIcon className="w-6 h-6" />}
              title="Auto Captions"
              description="AI-powered captions generated locally. No cloud upload, complete privacy."
            />
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
                or sharing product demos — SnapIt gives you the tools to make
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
                  {/* Simulated video editor UI */}
                  <div className="h-full flex flex-col gap-3">
                    {/* Preview area */}
                    <div className="flex-1 rounded-lg bg-[var(--background)] border border-[var(--border)] flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
                        <PlayIcon className="w-8 h-8 text-[var(--accent)]" />
                      </div>
                    </div>
                    {/* Timeline */}
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
            Download SnapIt for free and start recording in seconds.
            <br />
            No account required.
          </p>

          <div className="inline-flex flex-col items-center gap-4">
            <a
              href="https://github.com/walterlow/snapit-releases/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary flex items-center gap-3 text-lg px-8 py-4"
            >
              <WindowsIcon className="w-6 h-6" />
              Download for Windows
            </a>
            <span className="text-sm text-[var(--muted)]">
              {displayVersion ? `Version ${displayVersion} • Windows 10/11` : "Windows 10/11"}
            </span>
          </div>

          <div className="mt-16 pt-16 border-t border-[var(--border)]">
            <p className="text-sm text-[var(--muted)]">
              Privacy-focused • No account required • Free forever
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-[var(--border)]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-md bg-[var(--accent)] flex items-center justify-center">
              <RecordIcon className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm text-[var(--muted)]">
              SnapIt © {new Date().getFullYear()}
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

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="feature-card p-6 rounded-2xl bg-[var(--surface)] border border-[var(--border)]">
      <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center mb-4 text-[var(--accent)]">
        {icon}
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ fontFamily: "var(--font-sora)" }}
      >
        {title}
      </h3>
      <p className="text-[var(--muted)] text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
}
