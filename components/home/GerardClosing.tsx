import React, { useEffect, useId, useRef, useState } from "react";
import s from "./GerardClosing.module.css";

/* ------------------ CTA ------------------ */

export function GerardCta({ demoHref }: { demoHref: string }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} className={`${s.cta} ${seen ? s.seen : ""}`} id="demo" aria-label="Demander une démo">
      <div className={s.band}>
        <span className={s.bandTrace} aria-hidden />
        <p className={s.bandText}>
          <span className={s.bandDot} aria-hidden />
          <span>
            30 minutes pour voir comment Gerard simplifie votre dispatch.
          </span>
        </p>
        <div className={s.bandActions}>
          <a href="#film" className={s.bandSecondary}>
            <span className={s.bandPlay} aria-hidden>
              ▶
            </span>
            Voir Gerard en action
          </a>
          <a href={demoHref} className={s.bandPrimary}>
            Demander une démo
            <span className={s.bandArrow} aria-hidden>
              →
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------ FAQ ------------------ */

type Qa = { q: string; a: React.ReactNode };

const FAQ = (demoHref: string): Qa[] => [
  {
    q: "Gerard, c’est quoi exactement ?",
    a: "Votre exploitation sur un seul écran : demandes, missions, planning, chauffeurs, camions et remorques, suivi, rentabilité, facturation et parc. Ce qui vivait dans votre tête, vos mails et vos tableurs se retrouve au même endroit.",
  },
  {
    q: "À qui s’adresse Gerard ?",
    a: "Aux entreprises de transport qui veulent centraliser leur dispatch et simplifier leur exploitation. Dirigeants, exploitants, dispatchers : ceux qui savent où est le camion 412, et aimeraient ne plus être les seuls.",
  },
  {
    q: "Est-ce que Gerard remplace mon logiciel actuel ?",
    a: "Peut-être. Peut-être pas. L’objectif n’est pas d’ajouter un logiciel de plus, mais de simplifier votre exploitation. On regarde votre fonctionnement actuel et on voit ce qui mérite vraiment d’être remplacé, ou simplement connecté.",
  },
  {
    q: "Comment les missions sont-elles créées ?",
    a: "Une demande client arrive, elle est créée ou importée dans Gerard, devient une mission à planifier, puis rejoint le planning où elle est affectée. Toujours le même chemin, ce qui est précisément le but.",
  },
  {
    q: "Les chauffeurs utilisent-ils Gerard ?",
    a: "Oui. Ils ont leur propre interface, pensée pour le téléphone : ils consultent leur mission, les adresses et les horaires, et font avancer son statut. Vous suivez l’avancement sans passer la journée au téléphone.",
  },
  {
    q: "Peut-on suivre les véhicules ?",
    a: "Oui, à partir des données qui remontent. Le suivi et la carte s’appuient sur ce que transmettent le chauffeur ou le dispositif que vous utilisez. Gerard n’est pas un boîtier télématique : on regarde ensemble ce qui existe déjà chez vous.",
  },
  {
    q: "Gerard gère-t-il les camions et remorques ?",
    a: "Oui. Ils sont affectés aux missions depuis le planning, et le module Parc garde leur suivi : entretien, contrôles, historique.",
  },
  {
    q: "Gerard gère-t-il la facturation ?",
    a: "Oui. Les missions alimentent la facturation et chaque facture reste rattachée à ses missions. La fin de mois ressemble moins à une chasse au trésor.",
  },
  {
    q: "Peut-on suivre la rentabilité ?",
    a: "Oui, dès que les données nécessaires sont renseignées : Gerard rapproche chiffre d’affaires, coûts et marge opérationnelle. Les chiffres sont aussi bons que ce qu’on leur donne, comme partout.",
  },
  {
    q: "Combien de temps faut-il pour commencer ?",
    a: "Ça dépend de votre organisation et des données dont vous disposez déjà. Une démo permet d’évaluer rapidement le périmètre et de vous donner un délai réaliste. Réaliste, pas optimiste.",
  },
  {
    q: "Peut-on voir Gerard avant de s’engager ?",
    a: (
      <>
        Oui, c’est même conseillé. On vous montre Gerard sur un cas proche du vôtre, et vous jugez sur pièce.{" "}
        <a href={demoHref} className={s.inlineLink}>
          Demander une démo
        </a>
      </>
    ),
  },
];

export function GerardFaq({ demoHref }: { demoHref: string }) {
  const [open, setOpen] = useState<number | null>(0);
  const baseId = useId();
  const items = FAQ(demoHref);

  return (
    <section className={s.faq} id="faq" aria-labelledby="faq-title">
      <div className={s.faqInner}>
        <header className={s.faqHead}>
          <p className={s.eyebrow}>
            <span className={s.eyebrowDot} /> Questions fréquentes
          </p>
          <h2 id="faq-title" className={s.faqTitle}>
            Les questions qu’on nous pose. <em>Avant la démo.</em>
          </h2>
          <a href={demoHref} className={s.faqAside}>
            La vôtre n’y est pas ? Posez-la en démo <span aria-hidden>→</span>
          </a>
        </header>

        <ul className={s.faqList}>
          {items.map((item, i) => {
            const isOpen = open === i;
            const btnId = `${baseId}-q${i}`;
            const panelId = `${baseId}-a${i}`;
            return (
              <li key={item.q} className={`${s.faqItem} ${isOpen ? s.faqOpen : ""}`}>
                <h3 className={s.faqQ}>
                  <button
                    id={btnId}
                    type="button"
                    className={s.faqButton}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    <span className={s.faqNum}>{String(i + 1).padStart(2, "0")}</span>
                    <span className={s.faqText}>{item.q}</span>
                    <span className={s.faqIcon} aria-hidden />
                  </button>
                </h3>
                <div id={panelId} role="region" aria-labelledby={btnId} className={s.faqPanel}>
                  <div className={s.faqPanelInner}>
                    <p className={s.faqA}>{item.a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
