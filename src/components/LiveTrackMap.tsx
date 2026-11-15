import React from 'react';
import { MapPin, Truck, Clock, Navigation } from 'lucide-react';
import type { Language, Order } from '../types';

interface LiveTrackMapProps {
  order: Order;
  language: Language;
}

export const LiveTrackMap: React.FC<LiveTrackMapProps> = ({ order, language }) => {
  // Compute normalized progress along farmer -> customer vector
  const totalLat = order.customerLat - order.farmerLat;
  const totalLng = order.customerLng - order.farmerLng;
  const denom = totalLat * totalLat + totalLng * totalLng;

  let progress = 0;
  if (order.status === 'delivered') {
    progress = 1;
  } else if (order.status === 'out_for_delivery' && denom > 0.000001) {
    const dot =
      (order.agentLat - order.farmerLat) * totalLat +
      (order.agentLng - order.farmerLng) * totalLng;
    progress = Math.min(0.95, Math.max(0.08, dot / denom));
  } else if (order.status === 'accepted_by_farmer' || order.status === 'awaiting_delivery') {
    progress = 0.04;
  }

  // SVG route coordinates (curved agrarian road path)
  const startX = 64;
  const startY = 128;
  const endX = 496;
  const endY = 58;
  const ctrlX = 280;
  const ctrlY = 18;

  // Quadratic Bezier point at t = progress
  const tVal = progress;
  const truckX =
    (1 - tVal) * (1 - tVal) * startX + 2 * (1 - tVal) * tVal * ctrlX + tVal * tVal * endX;
  const truckY =
    (1 - tVal) * (1 - tVal) * startY + 2 * (1 - tVal) * tVal * ctrlY + tVal * tVal * endY;

  const steps = [
    { key: 'placed', en: 'Placed', mr: 'नोंदवली' },
    { key: 'accepted_by_farmer', en: 'Packed at Farm', mr: 'शेतात तयार' },
    { key: 'out_for_delivery', en: 'In Transit', mr: 'प्रवासात' },
    { key: 'delivered', en: 'Delivered', mr: 'पोहोचली' },
  ];

  const activeIdx =
    order.status === 'delivered'
      ? 3
      : order.status === 'out_for_delivery'
      ? 2
      : order.status === 'accepted_by_farmer' || order.status === 'awaiting_delivery'
      ? 1
      : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Navigation className="h-4 w-4 text-emerald-800" />
          <span>
            {language === 'mr' ? 'थेट लोकेशन आणि पोहोचण्याची वेळ' : 'Live Route & Arrival Tracker'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-700 font-mono tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-emerald-800" />
            {order.status === 'delivered'
              ? language === 'mr'
                ? 'पोहोचली'
                : 'Arrived'
              : `ETA ${order.etaMinutes} min`}
          </span>
          <span>
            GPS: {order.agentLat.toFixed(4)}, {order.agentLng.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Live SVG Corridor Visualization */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <svg viewBox="0 0 560 170" className="w-full h-40">
          {/* Subtle coordinate grid */}
          <defs>
            <pattern id={`grid-${order.id}`} width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="560" height="170" fill={`url(#grid-${order.id})`} />

          {/* Planned route dashed line */}
          <path
            d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="4"
            strokeDasharray="6 6"
          />

          {/* Covered route solid emerald line */}
          <path
            d={`M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`}
            fill="none"
            stroke="#166534"
            strokeWidth="4"
            strokeDasharray={`${Math.round(progress * 520)} 600`}
          />

          {/* Farm Origin Pin */}
          <circle cx={startX} cy={startY} r="8" fill="#1e293b" />
          <circle cx={startX} cy={startY} r="3" fill="#ffffff" />
          <text x={startX} y={startY + 22} textAnchor="middle" fontSize="11" fill="#334155" fontWeight="600">
            {order.farmName || order.farmerName}
          </text>

          {/* Customer Destination Pin */}
          <circle cx={endX} cy={endY} r="8" fill="#166534" />
          <circle cx={endX} cy={endY} r="3" fill="#ffffff" />
          <text x={endX} y={endY + 22} textAnchor="middle" fontSize="11" fill="#0f172a" fontWeight="600">
            {order.deliveryCity} Buyer
          </text>

          {/* Live Delivery Vehicle Marker */}
          {order.status !== 'cancelled' && (
            <g transform={`translate(${truckX}, ${truckY})`}>
              <circle cx="0" cy="0" r="14" fill="#166534" fillOpacity="0.16" />
              <circle cx="0" cy="0" r="9" fill="#166534" />
              <text x="0" y="-15" textAnchor="middle" fontSize="10" fill="#166534" fontWeight="700">
                {order.status === 'delivered'
                  ? 'Delivered'
                  : order.deliveryAgentName
                  ? `${order.deliveryAgentName} · ${order.etaMinutes}m`
                  : 'Awaiting Pickup'}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Milestone Bar */}
      <div className="grid grid-cols-4 gap-2 pt-1">
        {steps.map((s, idx) => {
          const done = order.status !== 'cancelled' && idx <= activeIdx;
          return (
            <div key={s.key} className="space-y-1.5">
              <div className={`h-1.5 rounded-full ${done ? 'bg-emerald-800' : 'bg-slate-200'}`} />
              <p className={`text-xs font-medium ${done ? 'text-slate-900' : 'text-slate-400'}`}>
                {language === 'mr' ? s.mr : s.en}
              </p>
            </div>
          );
        })}
      </div>

      {order.deliveryAgentName && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-emerald-800" />
            <strong className="text-slate-900">{order.deliveryAgentName}</strong>
            <span>·</span>
            <span>{order.deliveryVehicle || 'Bulk Transport'}</span>
          </span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <MapPin className="h-3.5 w-3.5 text-slate-500" />
            {order.deliveryAddress}
          </span>
        </div>
      )}
    </div>
  );
};
