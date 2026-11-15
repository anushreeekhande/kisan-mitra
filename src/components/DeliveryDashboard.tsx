import React, { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { ArrowLeft, Truck, MapPin, CheckCircle2, Navigation, XCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { syncUserProfileToFirestore, updateOrderStatusInFirestore } from '../lib/firebase';
import { t } from '../lib/i18n';
import { LiveTrackMap } from './LiveTrackMap';
import type { Language, Order, User } from '../types';

interface DeliveryDashboardProps {
  language: Language;
  user: User | null;
  fbUser?: FirebaseUser | null;
  onUserUpdated: (u: User) => void;
  onBackHome: () => void;
  onOpenAuth: () => void;
}

export const DeliveryDashboard: React.FC<DeliveryDashboardProps> = ({
  language,
  user,
  fbUser,
  onUserUpdated,
  onBackHome,
  onOpenAuth,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadDeliveries = async () => {
    if (!user || user.role !== 'delivery') return;
    try {
      const res = await apiFetch<{ orders: Order[] }>('/api/orders');
      setOrders(res.orders);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadDeliveries();
  }, [user?.id, user?.role]);

  const handleToggleAvailability = async () => {
    if (!user) return;
    const res = await apiFetch<{ user: User }>('/api/users/availability', {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: !user.isAvailable }),
    });
    onUserUpdated(res.user);
    if (fbUser) {
      syncUserProfileToFirestore(res.user, fbUser).catch(() => {});
    }
  };

  const handleAction = async (
    orderId: string,
    action: 'take' | 'decline' | 'update_location' | 'deliver'
  ) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/orders/${orderId}/delivery-action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      if (fbUser) {
        if (action === 'take') {
          updateOrderStatusInFirestore(orderId, 'out_for_delivery', fbUser).catch(() => {});
        } else if (action === 'deliver') {
          updateOrderStatusInFirestore(orderId, 'delivered', fbUser).catch(() => {});
        }
      }
      setFeedback(
        action === 'take'
          ? 'Delivery request accepted! Live route tracking is active for the buyer.'
          : action === 'decline'
          ? 'Delivery request declined and removed from your queue.'
          : action === 'update_location'
          ? 'Live GPS location and ETA updated for customer.'
          : 'Order marked as Delivered! Payment settled.'
      );
      loadDeliveries();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Action failed');
    }
  };

  if (!user || user.role !== 'delivery') {
    return (
      <section className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t(language, 'backHome')}</span>
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t(language, 'navDelivery')}</h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {language === 'mr'
              ? 'डिलिव्हरी विनंत्या स्वीकारण्यासाठी किंवा रद्द करण्यासाठी आणि लाइव्ह लोकेशन शेअर करण्यासाठी Google किंवा SMS OTP ने डिलिव्हरी एजंट म्हणून साइन इन करा.'
              : 'Sign in with Google or SMS OTP as a Delivery Agent to take or decline bulk pickup requests and stream live GPS coordinates & ETA to buyers.'}
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            {t(language, 'signInRegister')}
          </button>
        </div>
      </section>
    );
  }

  const openRequests = orders.filter((o) => !o.deliveryAgentId && o.status === 'accepted_by_farmer');
  const myDeliveries = orders.filter((o) => o.deliveryAgentId === user.id);

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-8 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t(language, 'backHome')}</span>
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{user.name}</h1>
            <p className="text-xs text-slate-500">
              {user.vehicleType || 'Bulk Transport'} · {user.area}, {user.city}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleAvailability}
          className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            user.isAvailable
              ? 'bg-emerald-800 text-white hover:bg-emerald-900'
              : 'border border-slate-300 bg-white text-slate-700'
          }`}
        >
          {user.isAvailable ? 'On Duty · Accepting Requests' : 'Off Duty'}
        </button>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </div>
      )}

      {/* Open Bulk Pickup Requests */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          {language === 'mr' ? 'नवीन डिलिव्हरी विनंत्या' : 'Incoming Bulk Delivery Requests'} (
          {openRequests.length})
        </h2>

        {openRequests.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            No open farm pickup requests available right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {openRequests.map((order) => (
              <div
                key={order.id}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-slate-500">{order.orderCode}</p>
                    <h3 className="text-base font-bold text-slate-900">
                      {order.productNameEn} · {order.quantityKg} kg
                    </h3>
                  </div>
                  <span className="font-mono text-sm font-semibold text-emerald-900 tabular-nums">
                    ETA ~{order.etaMinutes}m
                  </span>
                </div>

                <div className="space-y-1 text-xs text-slate-600">
                  <p>
                    <strong className="text-slate-900">Pickup:</strong> {order.farmName} (
                    {order.farmerName})
                  </p>
                  <p>
                    <strong className="text-slate-900">Drop:</strong> {order.customerName} ·{' '}
                    {order.deliveryAddress}
                  </p>
                  <p>
                    <strong className="text-slate-900">Payment:</strong> {order.paymentMethod} (
                    {order.paymentStatus})
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAction(order.id, 'take')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900"
                  >
                    <Truck className="h-4 w-4" />
                    <span>{t(language, 'takeDelivery')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAction(order.id, 'decline')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>{t(language, 'declineDelivery')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Active & Completed Deliveries */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          {language === 'mr' ? 'माझ्या डिलिव्हरी ट्रिप्स' : 'My Assigned Deliveries'} (
          {myDeliveries.length})
        </h2>

        <div className="space-y-5">
          {myDeliveries.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs text-slate-500">
                    {order.orderCode} · {order.status.replace(/_/g, ' ')}
                  </p>
                  <h3 className="text-lg font-bold text-slate-900">
                    {order.productNameEn} — {order.quantityKg} kg
                  </h3>
                  <p className="text-xs text-slate-600 flex items-center gap-1 mt-1">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    {order.deliveryAddress} ({order.customerName} · {order.customerPhone})
                  </p>
                </div>

                {order.status === 'out_for_delivery' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAction(order.id, 'update_location')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800 px-4 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                    >
                      <Navigation className="h-3.5 w-3.5" />
                      <span>{t(language, 'shareLiveLocation')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(order.id, 'deliver')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{t(language, 'markDelivered')}</span>
                    </button>
                  </div>
                )}
              </div>

              <LiveTrackMap order={order} language={language} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
