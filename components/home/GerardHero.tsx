import React, { useCallback, useEffect, useRef, useState } from "react";
import s from "./GerardHome.module.css";

/* ------------------ Content ------------------ */

export const DEMO_HREF = "#contact";

// What a dispatcher is carrying in their head at 7:40 on a Monday.
const THOUGHTS = [
  "c’était le 412 ou le 418 ?",
  "rappeler Euromove avant 16 h",
  "qui a la remorque 7 ?",
  "Karim finit à quelle heure ?",
  "Sedan → Reims, facturé ?",
  "contrôle technique du 21…",
  "Liège demain : personne.",
  "le client a changé l’adresse. encore.",
] as const;

// Scattered positions for the desktop "mental noise" layer (percent of hero).
const THOUGHT_SPOTS = [
  { top: "3%", left: "44%" },
  { top: "9%", left: "66%" },
  { top: "3%", left: "86%" },
  { top: "42%", left: "72%" },
  { top: "49%", left: "88%" },
  { top: "17%", left: "90%" },
  { top: "35%", left: "91%" },
  { top: "57%", left: "78%" },
] as const;

// Chapters of the 34 s film, in seconds.
const CHAPTERS = [
  { t: 0, label: "Planning" },
  { t: 2, label: "Demandes" },
  { t: 8, label: "Mission" },
  { t: 12, label: "Affectation" },
  { t: 18, label: "Chauffeur" },
  { t: 24, label: "Suivi" },
  { t: 30, label: "Gerard" },
] as const;

const FILM_DURATION = 34.25;

/* ------------------ Hooks ------------------ */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/* ------------------ Pieces ------------------ */

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`${s.wordmark} ${className ?? ""}`} aria-label="Gerard">
      Gerard<span className={s.dot} aria-hidden />
    </span>
  );
}

function ThoughtCloud() {
  return (
    <div className={s.cloud} aria-hidden>
      {THOUGHTS.map((text, idx) => (
        <span
          key={text}
          className={s.thought}
          style={
            {
              ...THOUGHT_SPOTS[idx],
              "--delay": `${idx * 1.35}s`,
            } as unknown as React.CSSProperties
          }
        >
          {text}
        </span>
      ))}
    </div>
  );
}

/* ------------------ Film ------------------ */

type FilmHandle = { playWithSound: () => void };

function Film({
  reduced,
  handleRef,
}: {
  reduced: boolean;
  handleRef: React.MutableRefObject<FilmHandle | null>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);

  // Scroll-linked tilt: the frame lies back like a screen on a desk,
  // then straightens as it arrives in front of the reader.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || reduced) {
      el?.style.setProperty("--p", "1");
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
      el.style.setProperty("--p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // Only play (muted) while visible; never autoplay when motion is reduced.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          v.play().catch(() => undefined);
        } else if (v.muted) {
          v.pause();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => undefined);
  }, []);

  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (v.paused) v.play().catch(() => undefined);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  };

  useEffect(() => {
    handleRef.current = {
      playWithSound: () => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = 0;
        v.muted = false;
        setMuted(false);
        v.play().catch(() => undefined);
      },
    };
  }, [handleRef]);

  const duration = videoRef.current?.duration || FILM_DURATION;
  const activeIdx = CHAPTERS.reduce((acc, c, idx) => (time >= c.t ? idx : acc), 0);

  return (
    <div ref={stageRef} className={s.stage} id="film">
      <div className={s.frame}>
        <div className={s.chrome}>
          <span className={s.chromeLeft}>
            <span className={s.chromeDot} />
            gerard / semaine 38
          </span>
          <span className={s.chromeCenter}>{CHAPTERS[activeIdx].label}</span>
          <span className={s.chromeRight}>
            {String(Math.floor(time)).padStart(2, "0")} / 34 s
          </span>
        </div>

        <div className={s.screen}>
          <video
            ref={videoRef}
            className={`${s.video} ${ready ? s.videoReady : ""}`}
            src="/gerard/gerard-film.mp4"
            poster="/gerard/gerard-film-poster.jpg"
            muted
            loop
            playsInline
            preload="metadata"
            onCanPlay={() => setReady(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
            aria-label="Film de présentation de Gerard : demandes, mission, planning, chauffeur, suivi"
          />

          {!playing && (
            <button type="button" className={s.bigPlay} onClick={togglePlay}>
              <span className={s.bigPlayIcon} aria-hidden>
                ▶
              </span>
              Lancer le film · 34 s
            </button>
          )}

          <div className={s.controls}>
            <button
              type="button"
              className={s.ctrl}
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Lecture"}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button type="button" className={s.ctrl} onClick={toggleSound}>
              {muted ? "Son coupé" : "Son activé"}
            </button>
          </div>
        </div>

        <div className={s.progress} aria-hidden>
          <span style={{ width: `${(time / duration) * 100}%` }} />
        </div>
      </div>

      <ol className={s.chapters}>
        {CHAPTERS.map((c, idx) => (
          <li key={c.label}>
            <button
              type="button"
              className={`${s.chapter} ${idx === activeIdx ? s.chapterActive : ""}`}
              onClick={() => seek(c.t)}
            >
              <span className={s.chapterTime}>{String(c.t).padStart(2, "0")}s</span>
              {c.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------ Hero ------------------ */

export default function GerardHero() {
  const reduced = usePrefersReducedMotion();
  const filmRef = useRef<FilmHandle | null>(null);

  const watch = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("film")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    filmRef.current?.playWithSound();
  };

  return (
    <section className={s.hero}>
      <ThoughtCloud />

      <div className={s.heroInner}>
        <p className={s.eyebrow}>
          <span className={s.eyebrowDot} />
          Dispatch pour les entreprises de transport
        </p>

        <h1 className={s.headline}>
          <span className={s.lineA}>Quand tout roule.</span>
          <span className={s.lineB}>
            Pour de vrai<span className={s.dot} aria-hidden />
          </span>
        </h1>

        <div className={s.heroFoot}>
          <p className={s.lede}>
            Demandes, missions, planning, chauffeurs, camions, remorques, factures&nbsp;: Gerard met
            tout sur un seul écran. Parce que «&nbsp;je crois que c’était le 412&nbsp;» n’est pas un
            système.
          </p>
          <div className={s.ctas}>
            <a href="#film" className={s.ctaPrimary} onClick={watch}>
              <span className={s.ctaPlay} aria-hidden>
                ▶
              </span>
              Voir Gerard en action
            </a>
            <a href={DEMO_HREF} className={s.ctaGhost}>
              Demander une démo
            </a>
          </div>
        </div>
      </div>

      <Film reduced={reduced} handleRef={filmRef} />
    </section>
  );
}
