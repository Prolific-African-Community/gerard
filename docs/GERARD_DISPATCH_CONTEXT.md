# GERARD DISPATCH — CONTEXT & RULES

## Project Overview

Gerard is a transport management and dispatching platform for road transport companies: their own trucking and logistics operations.

The system must provide a highly interactive and premium dispatching experience optimized for:

- large desktop screens;
- touch screens;
- real-time transport planning;
- driver mission management;
- operational visibility.

The platform is intended to replace traditional transport spreadsheets and fragmented communication methods with a centralized intelligent dispatch system.

---

# Core Vision

The application revolves around a large interactive weekly dispatch board.

Dispatchers must be able to:

- visualize all drivers;
- visualize all trucks;
- assign missions using drag & drop;
- monitor transport status;
- monitor truck availability;
- monitor delivery completion status;
- later monitor GPS positions in real time.

The interface must remain:

- ultra minimal;
- extremely clean;
- operationally efficient;
- visually premium.

The design language should feel like:

- Tesla operations software;
- modern logistics software;
- Apple-level UI simplicity;
- Vercel-style spacing and typography;
- industrial premium minimalism.

---

# Main Modules

## 1. Dispatcher Board

Main operational interface.

### Features

- Weekly calendar grid
- Driver rows
- Truck plate column
- Drag & drop missions
- Multiple missions per cell
- Interactive mission cards
- Mission status tracking
- Real-time updates
- Touch-screen optimized UX

### Weekly Layout

| Driver | Truck | Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday |

---

## 2. Mission Intake System

Transport missions originate from Gmail emails.

The system must later:

- connect to Gmail API;
- read incoming transport orders;
- extract mission data;
- automatically generate draggable mission cards.

### Mission Data

- Reference number
- Pickup address
- Delivery address
- Client name
- Estimated kilometers
- Notes
- Delivery constraints
- Schedule
- Internal transport pricing
- Attachments if needed

---

## 3. Driver Interface

A simplified mobile-first dashboard for truck drivers.

Drivers only see:

- assigned missions;
- addresses;
- references;
- schedules;
- estimated distance;
- delivery instructions;
- navigation support;
- mission statuses.

Drivers MUST NOT see:

- pricing;
- internal margins;
- dispatcher notes;
- sensitive operational information.

---

## 4. GPS Tracking

Truck GPS devices are already installed.

The platform must later integrate:

- truck GPS providers;
- live truck coordinates;
- live map visualization;
- estimated arrival times;
- intelligent dispatch assistance.

Google Places API will be used for:

- address normalization;
- autocomplete;
- place validation;
- geolocation consistency.

Google Places is NOT the GPS tracking source.

---

# Technical Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

## UI / Interaction

- dnd-kit
- Framer Motion
- TanStack Table later if needed

## Backend

- Next.js API Routes
- Prisma ORM
- PostgreSQL / Neon

## Integrations

- Gmail API
- Google Places API
- Google Routes API
- GPS provider APIs
- WhatsApp API later

---

# UI Rules

## General Feel

- Premium
- Minimal
- Industrial
- Elegant
- Operationally efficient

## Colors

Primary palette:

- graphite
- black
- white
- subtle lime accents

Avoid:

- saturated colors;
- heavy gradients;
- clutter;
- unnecessary shadows.

---

# UX Rules

## Dispatcher Experience

The dispatcher must:

- understand the full week instantly;
- move missions quickly;
- avoid excessive clicks;
- operate efficiently on large screens.

The interface should prioritize:

- speed;
- clarity;
- visual hierarchy;
- operational awareness.

---

# Mission Card Rules

Mission cards must remain compact.

Required visible info:

- reference
- pickup city
- delivery city
- kilometers
- status

Expandable details later.

---

# Driver Rules

Drivers should only have:

- mission visibility;
- status updates;
- navigation assistance;
- pause management;
- delivery confirmation.

No operational finance data.

---

# MVP PRIORITIES

## Phase 1

Build:

- dispatch board
- drag & drop
- mock missions
- mock drivers
- mock trucks

DO NOT build yet:

- Gmail integration
- GPS integration
- WhatsApp integration
- AI parsing
- optimization engine

---

# Data Seeding & Cleanup

The Prisma seed is intentionally minimal:

- it keeps only the dispatcher login user required for `/login`;
- it does not create operational demo drivers, trucks, trailers, missions, assignments, GPS positions, or route caches;
- Gmail imports remain mocked by the imported missions API until a dispatcher validates them into real missions.

Operational cleanup is explicit and manual:

```bash
npx tsx prisma/cleanup-operational-data.ts
```

Drivers, trucks, trailers, and missions must be created from the dispatcher interface. Manual GPS positions are entered from the dispatcher UI and stored as `TruckPosition` records with provider `MANUAL_DISPATCHER`.

Planning rows are persisted operational containers for the active week. A row can exist without a driver or truck, and drivers/trucks/missions are attached to rows by drag and drop from the dispatcher UI.

---

# Development Philosophy

Build progressively.

Priority order:

1. visual structure;
2. interaction quality;
3. database persistence;
4. integrations;
5. intelligent automation.

Avoid:

- premature complexity;
- overengineering;
- unnecessary abstractions.

---

# Folder Structure

/app
/dispatch

/components
/dispatch

/lib
/dispatch

/prisma

/docs

---

# Naming Convention

Product name:
Gerard

Brand signature:
Gerard. Gardez le contrôle. Pas tout en tête.

The application is referred to as "Gerard" everywhere in the UI. The former
Gerard branding is gone from the product; the only remaining occurrences are
legal invoicing data, the SL Automotive integration contract, and generated or
historical files (see the notes in those files).
