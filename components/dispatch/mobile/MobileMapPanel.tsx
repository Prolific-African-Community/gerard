import {
  GoogleMap,
  MarkerF,
  PolylineF,
  useJsApiLoader,
} from "@react-google-maps/api";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import { GERARD_BASE } from "../../../lib/dispatch/base-location";
import { decodePolyline } from "../../../lib/dispatch/polyline";
import type { Driver, Mission, Trailer, Truck } from "../../../lib/dispatch/mock-data";
import type { MissionPlacement, TruckPosition } from "./types";

type MobileMapPanelProps = {
  drivers: Driver[];
  missions: Mission[];
  placements: Record<string, MissionPlacement | null>;
  trailers: Trailer[];
  trucks: Truck[];
  truckPositions: TruckPosition[];
  onRefresh: () => Promise<void>;
};

type MobileTruckMarker = {
  id: string;
  truck: Truck;
  driver?: Driver;
  trailer?: Trailer;
  mission?: Mission;
  placement?: MissionPlacement | null;
  position: MapPoint;
  speedKmh?: number | null;
  recordedAt: string;
};

type MapPoint = {
  lat: number;
  lng: number;
};

type MapFilter = "all" | "mission" | "available" | "issue" | "live";
type RouteType = "mission" | "approach" | "return";

const filters: Array<{ id: MapFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "mission", label: "En mission" },
  { id: "available", label: "Disponibles" },
  { id: "issue", label: "Problèmes" },
  { id: "live", label: "Live" },
];

const routeLabels: Record<RouteType, string> = {
  mission: "Itinéraire",
  approach: "Approche",
  return: "Retour base",
};

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

export function MobileMapPanel({
  drivers,
  missions,
  placements,
  trailers,
  trucks,
  truckPositions,
  onRefresh,
}: MobileMapPanelProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<MapFilter>("all");
  const [visibleRoutes, setVisibleRoutes] = useState<Record<RouteType, boolean>>({
    mission: false,
    approach: false,
    return: false,
  });
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<RouteType | null>(null);

  const markers = useMemo(() => {
    const latestByTruckId = truckPositions.reduce<Map<string, TruckPosition>>(
      (items, position) => {
        if (!position.truckId || !isValidCoordinate(position.latitude, position.longitude)) {
          return items;
        }

        const current = items.get(position.truckId);
        if (!current || new Date(position.recordedAt) > new Date(current.recordedAt)) {
          items.set(position.truckId, position);
        }

        return items;
      },
      new Map(),
    );

    return Array.from(latestByTruckId.values()).flatMap((position) => {
      const truck = trucks.find((item) => item.id === position.truckId);
      if (!truck) {
        return [];
      }

      const driver = position.driverId
        ? drivers.find((item) => item.id === position.driverId)
        : truck.driverId
          ? drivers.find((item) => item.id === truck.driverId)
          : undefined;
      const trailer = trailers.find((item) => item.truckId === truck.id);
      const mission = missions.find((item) => {
        const placement = placements[item.id];
        return (
          placement?.truckId === truck.id &&
          item.status !== "done" &&
          item.status !== "cancelled"
        );
      });

      return [
        {
          id: truck.id,
          truck,
          driver,
          trailer,
          mission,
          placement: mission ? placements[mission.id] : null,
          position: {
            lat: position.latitude,
            lng: position.longitude,
          },
          speedKmh: position.speedKmh,
          recordedAt: position.recordedAt,
        },
      ];
    });
  }, [drivers, missions, placements, trailers, truckPositions, trucks]);

  const filteredMarkers = useMemo(() => {
    return markers.filter((marker) => {
      if (activeFilter === "all" || activeFilter === "live") {
        return true;
      }

      if (activeFilter === "mission") {
        return Boolean(marker.mission) || marker.truck.status === "ON_MISSION";
      }

      if (activeFilter === "available") {
        return marker.truck.status === "AVAILABLE" || marker.truck.status === "AT_BASE";
      }

      return (
        marker.mission?.status === "issue" ||
        marker.truck.status === "IN_MAINTENANCE" ||
        marker.truck.status === "MAINTENANCE_EXT" ||
        marker.truck.status === "OUT_OF_SERVICE"
      );
    });
  }, [activeFilter, markers]);

  const selectedMarker =
    markers.find((marker) => marker.id === selectedTruckId) ?? null;
  const routePaths = useMemo(() => {
    if (!selectedMarker) {
      return {
        mission: [],
        approach: [],
        return: [],
      };
    }

    return {
      mission: safeDecodePolyline(selectedMarker.mission?.routePolyline),
      approach: safeDecodePolyline(selectedMarker.placement?.approachPolyline),
      return: safeDecodePolyline(selectedMarker.truck.returnToBasePolyline),
    };
  }, [selectedMarker]);

  async function handleComputeRoute(type: RouteType) {
    if (!selectedMarker) {
      return;
    }

    const existingPath = routePaths[type];
    if (canRenderPolylinePath(existingPath)) {
      setVisibleRoutes((current) => ({
        ...current,
        [type]: !current[type],
      }));
      return;
    }

    const mission = selectedMarker.mission;
    const placement = selectedMarker.placement;

    if (type === "mission" && !mission) {
      setRouteError("Aucune mission active.");
      return;
    }

    if (type === "approach" && !placement?.assignmentId) {
      setRouteError("Aucune mission assignée.");
      return;
    }

    try {
      setLoadingRoute(type);
      setRouteError(null);
      setRouteMessage(null);

      if (type === "mission") {
        await postRoute("/api/dispatch/compute-mission-route", {
          missionId: mission?.id,
          forceRefresh: false,
        });
      }

      if (type === "approach") {
        await postRoute("/api/dispatch/compute-approach-route", {
          assignmentId: placement?.assignmentId,
          forceRefresh: false,
        });
      }

      if (type === "return") {
        await postRoute("/api/dispatch/compute-return-to-base-route", {
          truckId: selectedMarker.truck.id,
          forceRefresh: false,
        });
      }

      await onRefresh();
      setVisibleRoutes((current) => ({
        ...current,
        [type]: true,
      }));
      setRouteMessage(`${routeLabels[type]} prêt.`);
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : "Calcul impossible.");
    } finally {
      setLoadingRoute(null);
    }
  }

  if (!apiKey) {
    return (
      <MapFallback
        activeFilter={activeFilter}
        markers={filteredMarkers}
        onFilterChange={setActiveFilter}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <GoogleMobileMap
      activeFilter={activeFilter}
      apiKey={apiKey}
      filteredMarkers={filteredMarkers}
      loadingRoute={loadingRoute}
      markers={markers}
      routeError={routeError}
      routeMessage={routeMessage}
      routePaths={routePaths}
      selectedMarker={selectedMarker}
      visibleRoutes={visibleRoutes}
      onComputeRoute={handleComputeRoute}
      onFilterChange={setActiveFilter}
      onRefresh={onRefresh}
      onSelect={setSelectedTruckId}
    />
  );
}

function GoogleMobileMap({
  activeFilter,
  apiKey,
  filteredMarkers,
  loadingRoute,
  markers,
  routeError,
  routeMessage,
  routePaths,
  selectedMarker,
  visibleRoutes,
  onComputeRoute,
  onFilterChange,
  onRefresh,
  onSelect,
}: {
  activeFilter: MapFilter;
  apiKey: string;
  filteredMarkers: MobileTruckMarker[];
  loadingRoute: RouteType | null;
  markers: MobileTruckMarker[];
  routeError: string | null;
  routeMessage: string | null;
  routePaths: Record<RouteType, MapPoint[]>;
  selectedMarker: MobileTruckMarker | null;
  visibleRoutes: Record<RouteType, boolean>;
  onComputeRoute: (type: RouteType) => void;
  onFilterChange: (filter: MapFilter) => void;
  onRefresh: () => Promise<void>;
  onSelect: (truckId: string | null) => void;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    id: "gerard-mobile-dispatch-map",
  });

  async function handleRefresh() {
    try {
      setIsRefreshing(true);
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleRecenter() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (selectedMarker) {
      const points = getSelectedMapPoints(selectedMarker, routePaths, visibleRoutes);
      if (points.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        points.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 56);
        return;
      }

      map.panTo(selectedMarker.position);
      map.setZoom(12);
      return;
    }

    const points = [GERARD_BASE, ...filteredMarkers.map((marker) => marker.position)];
    fitMapToPoints(map, points, 48);
  }

  if (loadError) {
    return (
      <MapFallback
        activeFilter={activeFilter}
        markers={filteredMarkers}
        onFilterChange={onFilterChange}
        onRefresh={onRefresh}
      />
    );
  }

  if (!isLoaded) {
    return (
      <div className="px-4 pb-28 pt-4">
        <MapHeader
          activeFilter={activeFilter}
          isRefreshing={false}
          markerCount={0}
          onFilterChange={onFilterChange}
          onRecenter={() => null}
          onRefresh={handleRefresh}
        />
        <div className="mt-3 flex h-[62vh] items-center justify-center rounded-[32px] bg-white text-sm font-bold text-[#73796d] shadow-[0_14px_38px_rgba(17,18,15,0.07)]">
          Chargement carte...
        </div>
      </div>
    );
  }

  const baseIcon = {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 11,
    fillColor: "#11130f",
    fillOpacity: 1,
    strokeColor: "#B9FF4A",
    strokeWeight: 3,
  };
  const pickupPoint = getMissionPoint(selectedMarker?.mission, "pickup");
  const deliveryPoint = getMissionPoint(selectedMarker?.mission, "delivery");
  const shouldRenderMissionRoute =
    Boolean(selectedMarker) && canRenderPolylinePath(routePaths.mission);

  return (
    <div className="px-4 pb-28 pt-4">
      <MapHeader
        activeFilter={activeFilter}
        isRefreshing={isRefreshing}
        markerCount={filteredMarkers.length}
        onFilterChange={onFilterChange}
        onRecenter={handleRecenter}
        onRefresh={handleRefresh}
      />

      <section className="relative mt-3 h-[64vh] overflow-hidden rounded-[32px] bg-white shadow-[0_14px_38px_rgba(17,18,15,0.10)]">
        <GoogleMap
          center={filteredMarkers[0]?.position ?? GERARD_BASE}
          mapContainerStyle={mapContainerStyle}
          onClick={() => onSelect(null)}
          onLoad={(map) => {
            mapRef.current = map;
          }}
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            clickableIcons: false,
            gestureHandling: "greedy",
          }}
          zoom={filteredMarkers.length > 0 ? 9 : 8}
        >
          <MarkerF
            icon={baseIcon}
            label={{
              text: "B",
              color: "#ffffff",
              fontWeight: "900",
              fontSize: "12px",
            }}
            position={GERARD_BASE}
            title={GERARD_BASE.name}
          />

          {pickupPoint ? (
            <MarkerF
              icon={getMissionPointIcon("pickup")}
              label={{
                text: "D",
                color: "#11130f",
                fontWeight: "900",
                fontSize: "11px",
              }}
              position={pickupPoint}
              title="Départ"
            />
          ) : null}

          {deliveryPoint ? (
            <MarkerF
              icon={getMissionPointIcon("delivery")}
              label={{
                text: "L",
                color: "#11130f",
                fontWeight: "900",
                fontSize: "11px",
              }}
              position={deliveryPoint}
              title="Livraison"
            />
          ) : null}

          {filteredMarkers.map((marker) => (
            <MarkerF
              key={marker.id}
              icon={getTruckIcon(marker.truck.status)}
              label={{
                text: getTruckMarkerLabel(marker.truck.plateNumber),
                color: "#11130f",
                fontWeight: "900",
                fontSize: "10px",
              }}
              onClick={() => onSelect(marker.id)}
              position={marker.position}
              title={marker.truck.plateNumber}
            />
          ))}

          {shouldRenderMissionRoute ? (
            <PolylineF
              path={routePaths.mission}
              options={{
                strokeColor: "#181a16",
                strokeOpacity: visibleRoutes.mission ? 0.92 : 0.74,
                strokeWeight: visibleRoutes.mission ? 6 : 5,
              }}
            />
          ) : null}

          {visibleRoutes.approach && canRenderPolylinePath(routePaths.approach) ? (
            <PolylineF
              path={routePaths.approach}
              options={{
                strokeColor: "#2563eb",
                strokeOpacity: 0.78,
                strokeWeight: 4,
              }}
            />
          ) : null}

          {visibleRoutes.return && canRenderPolylinePath(routePaths.return) ? (
            <PolylineF
              path={routePaths.return}
              options={{
                strokeColor: "#6b7280",
                strokeOpacity: 0.72,
                strokeWeight: 4,
              }}
            />
          ) : null}
        </GoogleMap>

        {markers.length === 0 ? (
          <div className="absolute inset-x-4 bottom-4 rounded-[24px] bg-white/95 px-4 py-3 text-xs font-bold text-[#747a6f] shadow-[0_12px_30px_rgba(17,18,15,0.12)] backdrop-blur">
            Aucune position live pour le moment.
          </div>
        ) : null}
      </section>

      {!selectedMarker ? (
        <p className="mt-3 rounded-[24px] bg-white px-4 py-3 text-xs font-bold text-[#747a6f] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
          Touchez un camion pour voir les détails.
        </p>
      ) : null}

      <TruckBottomSheet
        loadingRoute={loadingRoute}
        marker={selectedMarker}
        routeError={routeError}
        routeMessage={routeMessage}
        routePaths={routePaths}
        visibleRoutes={visibleRoutes}
        onClose={() => onSelect(null)}
        onComputeRoute={onComputeRoute}
      />
    </div>
  );
}

function MapHeader({
  activeFilter,
  isRefreshing,
  markerCount,
  onFilterChange,
  onRecenter,
  onRefresh,
}: {
  activeFilter: MapFilter;
  isRefreshing: boolean;
  markerCount: number;
  onFilterChange: (filter: MapFilter) => void;
  onRecenter: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-[30px] bg-white p-3 shadow-[0_14px_38px_rgba(17,18,15,0.07)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-base font-black tracking-tight text-[#11120f]">Carte live</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a8174]">
            {markerCount} camion(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RoundButton
            label="Rafraîchir"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshIcon />
          </RoundButton>
          <RoundButton label="Recentrer" onClick={onRecenter}>
            <TargetIcon />
          </RoundButton>
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((filter) => {
          const isActive = activeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              className={[
                "min-h-10 shrink-0 rounded-full px-4 text-xs font-black transition active:scale-95",
                isActive
                  ? "bg-[#11130f] text-white shadow-[0_10px_24px_rgba(17,18,15,0.16)]"
                  : "bg-[#F4F5F1] text-[#6d7468]",
              ].join(" ")}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TruckBottomSheet({
  loadingRoute,
  marker,
  routeError,
  routeMessage,
  routePaths,
  visibleRoutes,
  onClose,
  onComputeRoute,
}: {
  loadingRoute: RouteType | null;
  marker: MobileTruckMarker | null;
  routeError: string | null;
  routeMessage: string | null;
  routePaths: Record<RouteType, MapPoint[]>;
  visibleRoutes: Record<RouteType, boolean>;
  onClose: () => void;
  onComputeRoute: (type: RouteType) => void;
}) {
  if (!marker) {
    return null;
  }

  const phoneHref = marker.driver?.phone
    ? `tel:${marker.driver.phone.replace(/\s+/g, "")}`
    : null;
  const hasMissionRoute =
    Boolean(marker.mission) &&
    (canRenderPolylinePath(routePaths.mission) ||
      hasMissionCoordinates(marker.mission));
  const hasApproach =
    Boolean(marker.placement?.assignmentId) &&
    Boolean(marker.mission) &&
    isValidMapPoint(marker.position);
  const hasReturn = isValidMapPoint(marker.position);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      <section className="rounded-[34px] bg-white p-4 text-[#11120f] shadow-[0_-18px_50px_rgba(17,18,15,0.20)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-black tracking-tight">
                {marker.truck.plateNumber}
              </h2>
              <StatusBadge value={truckStatusLabel(marker.truck.status)} />
            </div>
            <p className="mt-1 text-xs font-bold text-[#6b7167]">
              {[marker.truck.brand, marker.truck.model].filter(Boolean).join(" ") ||
                "Modèle non renseigné"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-sm font-black text-[#6f756b] transition active:scale-95"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <InfoTile label="Chauffeur" value={marker.driver?.name ?? "Non assigné"} />
          <InfoTile label="Remorque" value={marker.trailer?.plateNumber ?? "Non assignée"} />
          <InfoTile
            label="Mission"
            value={
              marker.mission
                ? `${marker.mission.reference} · ${marker.mission.pickupCity} → ${marker.mission.deliveryCity}`
                : "Aucune mission active"
            }
          />
          <InfoTile
            label="Position"
            value={`${formatDate(marker.recordedAt)}${
              typeof marker.speedKmh === "number"
                ? ` · ${Math.round(marker.speedKmh)} km/h`
                : ""
            }`}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {phoneHref ? (
            <a
              href={phoneHref}
              className="flex min-h-11 items-center justify-center rounded-full bg-[#11130f] px-4 text-sm font-black text-white transition active:scale-95"
            >
              Appeler
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-11 rounded-full bg-black/[0.04] px-4 text-sm font-black text-[#9aa094]"
            >
              Appel indisponible
            </button>
          )}
          <RouteButton
            active={visibleRoutes.mission || canRenderPolylinePath(routePaths.mission)}
            disabled={!hasMissionRoute}
            isLoading={loadingRoute === "mission"}
            label="Itinéraire"
            onClick={() => onComputeRoute("mission")}
          />
          <RouteButton
            active={visibleRoutes.approach}
            disabled={!hasApproach}
            isLoading={loadingRoute === "approach"}
            label="Approche"
            onClick={() => onComputeRoute("approach")}
          />
          <RouteButton
            active={visibleRoutes.return}
            disabled={!hasReturn}
            isLoading={loadingRoute === "return"}
            label="Retour base"
            onClick={() => onComputeRoute("return")}
          />
        </div>

        {routeMessage ? (
          <p className="mt-3 rounded-[18px] bg-[#B9FF4A]/25 px-3 py-2 text-xs font-bold text-[#526018]">
            {routeMessage}
          </p>
        ) : null}
        {routeError ? (
          <p className="mt-3 rounded-[18px] bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {routeError}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function MapFallback({
  activeFilter,
  markers,
  onFilterChange,
  onRefresh,
}: {
  activeFilter: MapFilter;
  markers: MobileTruckMarker[];
  onFilterChange: (filter: MapFilter) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="space-y-3 px-4 pb-28 pt-4">
      <MapHeader
        activeFilter={activeFilter}
        isRefreshing={false}
        markerCount={markers.length}
        onFilterChange={onFilterChange}
        onRecenter={() => null}
        onRefresh={() => {
          void onRefresh();
        }}
      />
      <div className="rounded-[32px] bg-white px-4 py-5 shadow-[0_14px_38px_rgba(17,18,15,0.07)]">
        <p className="text-sm font-bold text-[#11120f]">Carte indisponible</p>
        <p className="mt-1 text-xs font-semibold text-[#73796d]">
          Les positions live restent listées ci-dessous.
        </p>
      </div>
      {markers.length === 0 ? (
        <p className="rounded-[24px] bg-white px-4 py-4 text-sm font-semibold text-[#747a6f] shadow-[0_10px_30px_rgba(17,18,15,0.05)]">
          Aucune position live pour le moment.
        </p>
      ) : null}
      {markers.map((marker) => (
        <div
          key={marker.id}
          className="rounded-[28px] bg-white p-4 shadow-[0_14px_34px_rgba(17,18,15,0.07)]"
        >
          <p className="text-sm font-black text-[#11120f]">{marker.truck.plateNumber}</p>
          <p className="mt-1 text-xs font-semibold text-[#62685e]">
            {marker.driver?.name ?? "Sans chauffeur"}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#62685e]">
            {marker.mission
              ? `${marker.mission.reference} · ${marker.mission.pickupCity} → ${marker.mission.deliveryCity}`
              : "Aucune mission active"}
          </p>
        </div>
      ))}
    </div>
  );
}

function RouteButton({
  active,
  disabled,
  isLoading,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  isLoading: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      onClick={onClick}
      className={[
        "min-h-11 rounded-full px-4 text-sm font-black transition active:scale-95 disabled:cursor-not-allowed",
        active
          ? "bg-[#B9FF4A] text-[#11130f]"
          : "bg-black/[0.04] text-[#11130f] disabled:text-[#a0a69b]",
      ].join(" ")}
    >
      {isLoading ? "Calcul..." : active ? `${label} ✓` : label}
    </button>
  );
}

function RoundButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-[#11130f] text-white shadow-[0_12px_28px_rgba(17,18,15,0.16)] transition hover:bg-[#B9FF4A] hover:text-[#11130f] active:scale-95 disabled:opacity-50"
      aria-label={label}
    >
      {children}
    </button>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[20px] bg-[#F4F5F1] px-3 py-2.5">
      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#8a9084]">
        {label}
      </p>
      <p className="mt-1 line-clamp-2 text-xs font-bold text-[#20231d]">{value}</p>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-[#B9FF4A]/25 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-[#4d5a18]">
      {value}
    </span>
  );
}

function safeDecodePolyline(polyline: string | undefined) {
  if (!polyline) {
    return [];
  }

  try {
    return decodePolyline(polyline).filter(isValidMapPoint);
  } catch {
    return [];
  }
}

function canRenderPolylinePath(path: MapPoint[]) {
  return path.length >= 2 && path.every(isValidMapPoint);
}

function getSelectedMapPoints(
  marker: MobileTruckMarker,
  routePaths: Record<RouteType, MapPoint[]>,
  visibleRoutes: Record<RouteType, boolean>,
) {
  const points: MapPoint[] = [marker.position];
  const pickupPoint = getMissionPoint(marker.mission, "pickup");
  const deliveryPoint = getMissionPoint(marker.mission, "delivery");

  if (pickupPoint) {
    points.push(pickupPoint);
  }

  if (deliveryPoint) {
    points.push(deliveryPoint);
  }

  if (canRenderPolylinePath(routePaths.mission)) {
    points.push(...routePaths.mission);
  }

  if (visibleRoutes.approach && canRenderPolylinePath(routePaths.approach)) {
    points.push(...routePaths.approach);
  }

  if (visibleRoutes.return && canRenderPolylinePath(routePaths.return)) {
    points.push(...routePaths.return, GERARD_BASE);
  }

  return points.filter(isValidMapPoint);
}

function fitMapToPoints(map: google.maps.Map, points: MapPoint[], padding: number) {
  const validPoints = points.filter(isValidMapPoint);

  if (validPoints.length === 0) {
    map.panTo(GERARD_BASE);
    map.setZoom(8);
    return;
  }

  if (validPoints.length === 1) {
    map.panTo(validPoints[0]);
    map.setZoom(10);
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  validPoints.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, padding);
}

function getMissionPoint(mission: Mission | undefined, kind: "pickup" | "delivery") {
  if (!mission) {
    return null;
  }

  const latitude = kind === "pickup" ? mission.pickupLat : mission.deliveryLat;
  const longitude = kind === "pickup" ? mission.pickupLng : mission.deliveryLng;

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !isValidCoordinate(latitude, longitude)
  ) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}

function isValidMapPoint(point: MapPoint | undefined): point is MapPoint {
  if (!point) {
    return false;
  }

  return isValidCoordinate(point.lat, point.lng);
}

function isValidCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function hasMissionCoordinates(mission: Mission | undefined) {
  return Boolean(
    mission &&
      isValidCoordinatePair(mission.pickupLat, mission.pickupLng) &&
      isValidCoordinatePair(mission.deliveryLat, mission.deliveryLng),
  );
}

function isValidCoordinatePair(latitude: number | undefined, longitude: number | undefined) {
  return typeof latitude === "number" && typeof longitude === "number"
    ? isValidCoordinate(latitude, longitude)
    : false;
}

async function postRoute(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? "Calcul impossible.");
  }
}

function getTruckIcon(status: Truck["status"]) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 15,
    fillColor: getTruckStatusColor(status),
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

function getMissionPointIcon(kind: "pickup" | "delivery") {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 12,
    fillColor: kind === "pickup" ? "#B9FF4A" : "#f59e0b",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 3,
  };
}

function getTruckStatusColor(status: Truck["status"]) {
  if (
    status === "IN_MAINTENANCE" ||
    status === "MAINTENANCE_EXT" ||
    status === "OUT_OF_SERVICE"
  ) {
    return "#ef4444";
  }

  if (status === "ON_MISSION" || status === "EN_ROUTE_TO_PICKUP" || status === "AT_PICKUP") {
    return "#60a5fa";
  }

  if (status === "AVAILABLE" || status === "AT_BASE") {
    return "#B9FF4A";
  }

  return "#facc15";
}

function getTruckMarkerLabel(plateNumber: string) {
  return plateNumber.replace(/[^A-Z0-9]/gi, "").slice(-3) || "NTX";
}

function truckStatusLabel(status: Truck["status"]) {
  const labels: Partial<Record<NonNullable<Truck["status"]>, string>> = {
    AVAILABLE: "Disponible",
    ASSIGNED: "Assigné",
    EN_ROUTE_TO_PICKUP: "Vers pickup",
    AT_PICKUP: "Au pickup",
    ON_MISSION: "En mission",
    RETURNING_TO_BASE: "Retour base",
    AT_BASE: "À la base",
    IN_MAINTENANCE: "Maintenance",
    MAINTENANCE_EXT: "Maintenance extérieure",
    OUT_OF_SERVICE: "Hors service",
  };

  return status ? labels[status] ?? status : "Statut inconnu";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 18v-5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 9a7 7 0 0 0-11.6-2.7L4 8.5M6 15a7 7 0 0 0 11.6 2.7L20 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21v-3M12 6V3M21 12h-3M6 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
