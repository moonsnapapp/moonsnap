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
} from "./icons";

function getHomeDisplayVersion(latestVersion: string | null) {
  return latestVersion ?? latestRelease?.version ?? null;
}

function getHomeDownloadUrl(displayVersion: string | null) {
  return (
    getWindowsInstallerDownloadUrl(displayVersion) ??
    "https://github.com/moonsnapapp/moonsnap/releases/latest"
  );
}

async function getHomeDownloadInfo() {
  const latestVersion = await getLatestReleaseVersion();
  const displayVersion = getHomeDisplayVersion(latestVersion);
  const downloadUrl = getHomeDownloadUrl(displayVersion);

  return { displayVersion, downloadUrl };
}

export default async function Home() {
  const { displayVersion, downloadUrl } = await getHomeDownloadInfo();

  return (
    <div className="relative min-h-screen">
      {/* Background effects */}
      <div className="fixed inset-0 grid-pattern pointer-events-none" />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(156, 163, 175, 0.16) 0%, transparent 55%)",
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
            <Link
              href="/changelog"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Changelog
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            {/* Beta badge */}
            <div className="flex justify-center mb-5 animate-slide-up opacity-0">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]" />
                </span>
                Public Beta
              </span>
            </div>

            {/* Main headline */}
            <h1
              className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6 animate-slide-up opacity-0 delay-100"
              style={{ fontFamily: "var(--font-sora)" }}
            >
              <span className="gradient-text">Screen capture</span>
              <br />
              <span
                className="text-glow"
                style={{ color: "var(--accent-strong)" }}
              >
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
                Download for Windows
              </a>
            </div>

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
              <span style={{ color: "var(--accent-strong)" }}>capture & create</span>
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
            Download MoonSnap and start creating polished captures.
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
