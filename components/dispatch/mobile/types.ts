import type {
  DispatchDay,
  Driver,
  Mission,
  Trailer,
  Truck,
} from "../../../lib/dispatch/mock-data";

export type MobileTab =
  | "missions"
  | "drivers"
  | "trucks"
  | "trailers"
  | "map"
  | "profitability"
  | "invoices"
  | "park";

export type PlanningRow = {
  id: string;
  weekStartDate: string;
  sortOrder: number;
  driverId: string | null;
  truckId: string | null;
  trailerId?: string | null;
};

export type MissionPlacement = {
  assignmentId?: string;
  planningRowId?: string | null;
  driverId?: string | null;
  truckId?: string | null;
  /** Remorque prévue pour la mission (≠ attelage physique courant). */
  trailerId?: string | null;
  day: DispatchDay;
  approachDistanceMeters?: number;
  approachDurationSeconds?: number;
  approachPolyline?: string;
  approachCalculatedAt?: string;
  approachProvider?: string;
};

export type TruckPosition = {
  id: string;
  truckId: string;
  driverId?: string | null;
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  heading?: number | null;
  provider?: string | null;
  recordedAt: string;
};

export type MobileDispatchData = {
  drivers: Driver[];
  trucks: Truck[];
  trailers: Trailer[];
  missions: Mission[];
  planningRows: PlanningRow[];
  truckPositions: TruckPosition[];
  placements: Record<string, MissionPlacement | null>;
  truckAssignments: Record<string, string | null>;
};

export type AssignmentOption = {
  mission: Mission;
  placement?: MissionPlacement | null;
};
