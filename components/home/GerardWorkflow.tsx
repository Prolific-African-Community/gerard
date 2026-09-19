import React, { useEffect, useRef, useState } from "react";
import s from "./GerardWorkflow.module.css";

/* ------------------ Content ------------------ */

type Step = {
  key: string;
  label: string;
  status: string;
  title: string;
  text: string;
  time: string;
};

// One mission, followed from the first email to the last signature.
const STEPS: Step[] = [
  {
    key: "demande",
    label: "Demande",
    status: "Nouvelle",
    title: "Un mail arrive.",
    text: "Gerard en garde l’essentiel : adresses, créneaux, marchandise, prix. Inutile de le relire trois fois.",
    time: "07:52",
  },
  {
    key: "mission",
    label: "Mission",
    status: "À planifier",
    title: "Elle devient une mission.",
    text: "Un numéro, un client, une distance, et le type de remorque requis. Rien sur un post-it, rien de sous-entendu.",
    time: "08:05",
  },
  {
    key: "planning",
    label: "Planning",
    status: "Planifiée",
    title: "Chauffeur, camion, remorque : la bonne combinaison.",
    text: "Gerard vous aide à associer à chaque mission un chauffeur disponible, un camion et une remorque adaptée au chargement. Les conflits se voient avant de coûter quelque chose.",
    time: "08:09",
  },
  {
    key: "chauffeur",
    label: "Chauffeur",
    status: "Assignée",
    title: "Karim la reçoit.",
    text: "Sur son téléphone, avec le camion 412 et la remorque 7. Écrit, cette fois.",
    time: "08:11",
  },
  {
    key: "suivi",
    label: "Suivi",
    status: "En route",
    title: "Vous suivez sans appeler.",
    text: "Position, avancement, heure d’arrivée. Le téléphone peut rester dans la poche.",
    time: "10:47",
  },
  {
    key: "termine",
    label: "Terminé",
    status: "Terminée",
    title: "Terminé. Et tout le monde le sait.",
    text: "Chaque étape est tracée. La mission part en facturation sans chasse au bon de livraison.",
    time: "12:21",
  },
];

const MISSION = {
  ref: "GRD-260918-15",
  from: "Sedan",
  to: "Reims",
  client: "Euromove Cargo",
};

/* ------------------ Scenes ------------------ */

function SceneDemande() {
  return (
    <div className={s.mail}>
      <div className={s.mailHead}>
        <span className={s.avatar}>EC</span>
        <div>
          <strong>Euromove Cargo</strong>
          <span>transport@euromove-cargo.eu · 07:52</span>
        </div>
      </div>
      <p className={s.mailSubject}>Objet : Sedan → Reims jeudi</p>
      <p className={s.mailBody}>
        Bonjour, pourriez-vous prendre <mark>24 palettes</mark> à <mark>Sedan, zone logistique</mark>{" "}
        jeudi <mark>à 9 h</mark>, livraison <mark>Reims avant 12 h 30</mark> ? Tarif habituel,{" "}
        <mark>610 €</mark>. Merci !
      </p>
      <div className={s.extract}>
        {["Enlèvement · Sedan", "jeu. 09:00", "Livraison · Reims", "24 palettes", "610 EUR"].map((t, i) => (
          <span key={t} className={s.chip} style={{ "--i": i } as unknown as React.CSSProperties}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function SceneMission() {
  return (
    <div className={s.missionWrap}>
      <div className={s.missionCard}>
        <div className={s.missionTop}>
          <span className={s.mono}>{MISSION.ref}</span>
          <span className={s.pill}>À planifier</span>
        </div>
        <p className={s.missionRoute}>
          {MISSION.from} <span>→</span> {MISSION.to}
        </p>
        <p className={s.missionClient}>Client : {MISSION.client}</p>
        <dl className={s.missionMeta}>
          <div>
            <dt>Distance</dt>
            <dd>101 km calculés</dd>
          </div>
          <div>
            <dt>Enlèvement</dt>
            <dd>jeu. 17 · 09:00</dd>
          </div>
          <div>
            <dt>Livraison</dt>
            <dd>jeu. 17 · 12:30</dd>
          </div>
          <div>
            <dt>Prix</dt>
            <dd>610 EUR</dd>
          </div>
          <div className={s.missionNeed}>
            <dt>Besoin remorque</dt>
            <dd>
              Curtainsider · 24 palettes <span className={s.pill}>Requis</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// Planning rows: driver + the truck and trailer paired with them this week.
const CREWS = [
  { driver: "Marc Denis", truck: "408", trailer: "R3 · Frigo" },
  { driver: "Karim El Mansouri", truck: "412", trailer: "R7 · Curtainsider" },
  { driver: "Julien Morel", truck: "415", trailer: "R2 · Plateau" },
  { driver: "Sofia Marin", truck: "419", trailer: "R9 · Curtainsider" },
] as const;
const DAYS = ["Mer. 16", "Jeu. 17"] as const;
// Existing missions on the board: [row, col, label]
const BOOKED: [number, number, string][] = [
  [0, 0, "Liège → Lille"],
  [0, 1, "Namur → Anvers"],
  [1, 0, "Metz → Namur"],
  [2, 0, "Charleroi → Düsseldorf"],
  [3, 1, "Liège → Reims"],
];
const TARGET_ROW = 1;

function ScenePlanning() {
  return (
    <div className={s.board}>
      <div className={s.boardHead}>
        <span>Chauffeur</span>
        <span>Camion</span>
        <span>Remorque</span>
        {DAYS.map((d) => (
          <span key={d} className={s.boardDay}>
            <span className={d === "Jeu. 17" ? s.boardDayOn : undefined}>{d}</span>
          </span>
        ))}
      </div>
      {CREWS.map((crew, r) => {
        const isTarget = r === TARGET_ROW;
        return (
          <div key={crew.driver} className={`${s.boardRow} ${isTarget ? s.boardRowTarget : ""}`}>
            <span className={s.boardDriver}>{crew.driver}</span>
            <span className={`${s.asset} ${isTarget ? s.assetMatch : ""}`}>{crew.truck}</span>
            <span className={`${s.asset} ${isTarget ? s.assetMatch : ""}`}>
              {crew.trailer.split(" · ")[0]}
              <span className={s.trailerType}>&nbsp;· {crew.trailer.split(" · ")[1]}</span>
            </span>
            {DAYS.map((d, c) => {
              const booked = BOOKED.find(([br, bc]) => br === r && bc === c);
              const target = isTarget && c === 1;
              return (
                <span key={d} className={`${s.cell} ${s.boardDay} ${target ? s.cellTarget : ""}`}>
                  {booked && <span className={s.booked}>{booked[2]}</span>}
                  {target && (
                    <span className={s.dropped}>
                      <b>{MISSION.ref}</b>
                      {MISSION.from} → {MISSION.to}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        );
      })}
      <p className={s.boardMatch}>
        <span className={s.check} aria-hidden>
          ✓
        </span>
        Karim · camion 412 · remorque R7 curtainsider : compatible avec la mission
      </p>
    </div>
  );
}

function SceneChauffeur() {
  return (
    <div className={s.assign}>
      <div className={s.resources}>
        {[
          ["Chauffeur", "Karim El Mansouri"],
          ["Camion", "412 · GX-412-KM"],
          ["Remorque", "R7 · Curtainsider"],
        ].map(([k, v], i) => (
          <div key={k} className={s.resource} style={{ "--i": i } as unknown as React.CSSProperties}>
            <span>{k}</span>
            <strong>{v}</strong>
            <i className={s.check} aria-hidden>
              ✓
            </i>
          </div>
        ))}
      </div>
      <div className={s.phone}>
        <div className={s.phoneNotch} />
        <p className={s.phoneBrand}>
          Gerard<span className={s.limeDot} />
        </p>
        <p className={s.phoneKicker}>Mission principale</p>
        <p className={s.phoneRef}>{MISSION.ref}</p>
        <p className={s.phoneClient}>{MISSION.client}</p>
        <div className={s.phoneStops}>
          <p>
            <b>Sedan</b>jeu. 17 sept. · 09:00
          </p>
          <p>
            <b>Reims</b>jeu. 17 sept. · 12:30
          </p>
        </div>
        <span className={s.phoneBtn}>▶ Démarrer la mission</span>
      </div>
    </div>
  );
}

function SceneSuivi() {
  return (
    <div className={s.map}>
      <svg viewBox="0 0 600 360" className={s.mapSvg} aria-hidden>
        <defs>
          <pattern id="gw-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M30 0H0V30" fill="none" stroke="currentColor" strokeOpacity="0.07" />
          </pattern>
        </defs>
        <rect width="600" height="360" fill="url(#gw-grid)" />
        <path
          d="M470 70 C420 110 400 150 330 170 S220 230 170 260 S110 290 90 300"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth="22"
          strokeLinecap="round"
        />
        <path
          className={s.routeBase}
          d="M470 70 C420 110 400 150 330 170 S220 230 170 260 S110 290 90 300"
          pathLength={1}
        />
        <path
          className={s.routeDone}
          d="M470 70 C420 110 400 150 330 170 S220 230 170 260 S110 290 90 300"
          pathLength={1}
        />
        <circle cx="470" cy="70" r="7" className={s.nodeA} />
        <circle cx="90" cy="300" r="7" className={s.nodeB} />
        <g className={s.truck}>
          <circle r="16" className={s.truckHalo} />
          <circle r="8" className={s.truckDot} />
        </g>
      </svg>
      <span className={s.mapLabel} style={{ top: "12%", left: "74%" }}>
        Sedan
      </span>
      <span className={s.mapLabel} style={{ top: "86%", left: "11%" }}>
        Reims
      </span>
      <div className={s.eta}>
        <span className={s.live} />
        <div>
          <strong>En route · 62 %</strong>
          <span>Arrivée estimée 12:21 · 38 km restants</span>
        </div>
      </div>
    </div>
  );
}

const LOG = [
  ["07:52", "Demande reçue", "Euromove Cargo"],
  ["08:05", "Mission créée", MISSION.ref],
  ["08:11", "Affectée", "Karim · 412 · R7"],
  ["09:02", "Enlèvement", "Sedan"],
  ["12:21", "Livrée", "Reims · CMR signé"],
] as const;

function SceneTermine() {
  return (
    <div className={s.log}>
      <ol>
        {LOG.map(([t, what, detail], i) => (
          <li key={what} style={{ "--i": i } as unknown as React.CSSProperties}>
            <span className={s.logTime}>{t}</span>
            <span className={s.logDot} />
            <strong>{what}</strong>
            <span className={s.logDetail}>{detail}</span>
          </li>
        ))}
      </ol>
      <div className={s.invoice}>
        <span>Prête à facturer</span>
        <strong>610,00 €</strong>
      </div>
    </div>
  );
}

const SCENES = [SceneDemande, SceneMission, ScenePlanning, SceneChauffeur, SceneSuivi, SceneTermine];

/* ------------------ Section ------------------ */

export default function GerardWorkflow() {
  const trackRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  // Remount a scene each time it becomes active so its micro-animations replay.
  const visits = useRef<number[]>(STEPS.map(() => 0));
  const lastStep = useRef(0);
  if (lastStep.current !== step) {
    visits.current[step] += 1;
    lastStep.current = step;
  }

  // Scroll drives the story: the section is tall, the stage stays pinned.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      setProgress(p);
      setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
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
  }, []);

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY + total * ((i + 0.5) / STEPS.length);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  };

  const current = STEPS[step];

  return (
    <section ref={trackRef} className={s.track} id="workflow" aria-labelledby="workflow-title">
      <div className={s.pin}>
        <header className={s.head}>
          <p className={s.eyebrow}>
            <span className={s.limeDot} /> Le workflow
          </p>
          <h2 id="workflow-title" className={s.title}>
            De la demande à la facture. <em>Tout s’enchaîne</em>
            <span className={s.titleDot} aria-hidden />
          </h2>
        </header>

        <div className={s.body}>
          {/* Rail — the six moments, with a lime flow filling as you scroll. */}
          <ol className={s.rail} style={{ "--fill": progress } as unknown as React.CSSProperties}>
            {STEPS.map((st, i) => (
              <li key={st.key}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  className={`${s.railItem} ${i === step ? s.railOn : ""} ${i < step ? s.railDone : ""}`}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className={s.railNum}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={s.railLabel}>{st.label}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className={s.copy}>
            <div key={current.key} className={s.copyInner}>
              <p className={s.copyTime}>
                {current.time} · étape {step + 1}/6
              </p>
              <h3 className={s.copyTitle}>{current.title}</h3>
              <p className={s.copyText}>{current.text}</p>
            </div>
          </div>

          {/* Stage — the same mission, travelling through Gerard. */}
          <div className={s.stage}>
            <div className={s.stageBar}>
              <span className={s.mono}>{MISSION.ref}</span>
              <span className={s.stageRoute}>
                {MISSION.from} → {MISSION.to}
              </span>
              <span key={current.status} className={`${s.status} ${step === 5 ? s.statusDone : ""}`}>
                {current.status}
              </span>
            </div>
            <div className={s.stageTrack} aria-hidden>
              <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
            <div className={s.scenes}>
              {SCENES.map((Scene, i) => (
                <div
                  key={STEPS[i].key}
                  className={`${s.scene} ${i === step ? s.sceneOn : ""} ${i < step ? s.scenePast : ""}`}
                  aria-hidden={i !== step}
                >
                  <Scene key={visits.current[i]} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
