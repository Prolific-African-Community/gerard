import React, { useId, useState } from "react";
import s from "./GerardContact.module.css";
import {
  ContactPayload,
  WHATSAPP_GREETING,
  isWhatsAppConfigured,
  submitContact,
  whatsAppUrl,
} from "./contact";

type FieldName = keyof ContactPayload;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY: ContactPayload = { name: "", company: "", email: "", phone: "", message: "" };

function validate(v: ContactPayload): Errors {
  const e: Errors = {};
  if (!v.name.trim()) e.name = "Indiquez votre nom.";
  if (!v.company.trim()) e.company = "Indiquez votre société.";
  if (!v.email.trim()) e.email = "Indiquez votre email.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) e.email = "Cet email ne semble pas valide.";
  if (v.phone && v.phone.trim() && !/^[+\d][\d\s().-]{5,}$/.test(v.phone.trim()))
    e.phone = "Ce numéro ne semble pas valide.";
  if (v.message.trim().length < 10) e.message = "Quelques mots sur votre besoin (10 caractères minimum).";
  return e;
}

/* ------------------ Field ------------------ */

function Field({
  name,
  label,
  index,
  value,
  error,
  optional,
  multiline,
  type = "text",
  autoComplete,
  onChange,
  onBlur,
}: {
  name: FieldName;
  label: string;
  index: string;
  value: string;
  error?: string;
  optional?: boolean;
  multiline?: boolean;
  type?: string;
  autoComplete?: string;
  onChange: (name: FieldName, value: string) => void;
  onBlur: (name: FieldName) => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const common = {
    id,
    name,
    value,
    placeholder: " ",
    autoComplete,
    required: !optional,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    className: s.input,
    onBlur: () => onBlur(name),
  };

  return (
    <div className={`${s.field} ${multiline ? s.fieldWide : ""} ${error ? s.fieldError : ""}`}>
      <span className={s.index} aria-hidden>
        {index}
      </span>
      {multiline ? (
        <textarea
          {...common}
          rows={4}
          onChange={(e) => onChange(name, e.target.value)}
          className={`${s.input} ${s.textarea}`}
        />
      ) : (
        <input {...common} type={type} onChange={(e) => onChange(name, e.target.value)} />
      )}
      <label htmlFor={id} className={s.label}>
        {label}
        {optional && <span className={s.optional}> · optionnel</span>}
      </label>
      <span className={s.rule} aria-hidden />
      <span id={errorId} className={s.error} role={error ? "alert" : undefined}>
        {error}
      </span>
    </div>
  );
}

/* ------------------ Section ------------------ */

export default function GerardContact() {
  const [values, setValues] = useState<ContactPayload>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const configured = isWhatsAppConfigured();

  const onChange = (name: FieldName, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (touched[name]) setErrors(validate(next));
  };

  const onBlur = (name: FieldName) => {
    setTouched((t) => ({ ...t, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validate(values)[name] }));
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    setTouched({ name: true, company: true, email: true, phone: true, message: true });
    const first = Object.keys(found)[0] as FieldName | undefined;
    if (first) {
      e.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setSendError(null);
    submitContact({ ...values, phone: values.phone?.trim() || undefined }).catch(() =>
      setSendError("L’envoi n’est pas disponible pour le moment. Réessayez plus tard."),
    );
  };

  const fieldProps = { onChange, onBlur };
  const shown = (n: FieldName) => (touched[n] ? errors[n] : undefined);

  return (
    <section className={s.contact} id="contact" aria-labelledby="contact-title">
      <div className={s.inner}>
        <header className={s.head}>
          <p className={s.eyebrow}>
            <span className={s.eyebrowDot} /> Contact
          </p>
          <h2 id="contact-title" className={s.title}>
            Parlons de votre dispatch<span className={s.titleDot} aria-hidden />
          </h2>
          <p className={s.lede}>
            Montrez-nous comment vous travaillez aujourd’hui. On vous montre ce que Gerard peut simplifier.
          </p>

          <div className={s.whatsapp}>
            <p className={s.whatsappLabel}>Plus direct</p>
            {configured ? (
              <a
                href={whatsAppUrl(WHATSAPP_GREETING)}
                target="_blank"
                rel="noopener noreferrer"
                className={s.whatsappBtn}
              >
                <WhatsAppIcon />
                Écrire sur WhatsApp
                <span className={s.whatsappArrow} aria-hidden>
                  ↗
                </span>
              </a>
            ) : (
              <span className={`${s.whatsappBtn} ${s.whatsappOff}`} aria-disabled="true">
                <WhatsAppIcon />
                Écrire sur WhatsApp
              </span>
            )}
          </div>
        </header>

        <form className={s.form} onSubmit={onSubmit} noValidate aria-describedby="contact-note">
          <div className={s.grid}>
            <Field {...fieldProps} name="name" index="01" label="Nom" autoComplete="name" value={values.name} error={shown("name")} />
            <Field
              {...fieldProps}
              name="company"
              index="02"
              label="Société"
              autoComplete="organization"
              value={values.company}
              error={shown("company")}
            />
            <Field
              {...fieldProps}
              name="email"
              index="03"
              label="Email"
              type="email"
              autoComplete="email"
              value={values.email}
              error={shown("email")}
            />
            <Field
              {...fieldProps}
              name="phone"
              index="04"
              label="Téléphone"
              type="tel"
              autoComplete="tel"
              optional
              value={values.phone ?? ""}
              error={shown("phone")}
            />
            <Field
              {...fieldProps}
              name="message"
              index="05"
              label="Votre besoin, en quelques mots"
              multiline
              value={values.message}
              error={shown("message")}
            />
          </div>

          <div className={s.submitRow}>
            <p id="contact-note" className={s.note}>
              L’envoi ouvre WhatsApp avec votre message prérempli. Vous relisez, vous envoyez.
            </p>
            <button type="submit" className={s.submit}>
              Envoyer
              <span className={s.submitArrow} aria-hidden>
                →
              </span>
            </button>
          </div>
          {sendError && (
            <p className={s.sendError} role="alert">
              {sendError}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

function WhatsAppIcon() {
  return (
    <svg className={s.waIcon} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z"
      />
    </svg>
  );
}
