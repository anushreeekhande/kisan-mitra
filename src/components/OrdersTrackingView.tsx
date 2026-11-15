import React, { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  ArrowLeft,
  Star,
  CreditCard,
  XCircle,
  RefreshCw,
  Cloud,
  Camera,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  FIREBASE_PROJECT_ID,
  fetchFirestoreVault,
  payOrderInFirestore,
  rateOrderInFirestore,
  signInWithGoogleFirebase,
  syncPastRecordsToFirestore,
  updateOrderStatusInFirestore,
  type FirestoreCloudVault,
} from '../lib/firebase';
import { t } from '../lib/i18n';
import { resolveProduceImage } from '../lib/images';
import { LiveTrackMap } from './LiveTrackMap';
import type { Language, Order, ProduceListing, User } from '../types';

interface OrdersTrackingViewProps {
  language: Language;
  user: User | null;
  fbUser?: FirebaseUser | null;
  onBackHome: () => void;
  onOpenAuth: () => void;
}

export const OrdersTrackingView: React.FC<OrdersTrackingViewProps> = ({
  language,
  user,
  fbUser,
  onBackHome,
  onOpenAuth,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ratingDrafts, setRatingDrafts] = useState<
    Record<string, { farmerScore: number; deliveryScore: number; review: string }>
  >({});

  // Firebase Cloud Vault state
  const [vault, setVault] = useState<FirestoreCloudVault | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadVault = async (activeFbUser: FirebaseUser) => {
    try {
      const data = await fetchFirestoreVault(activeFbUser);
      setVault(data);
    } catch {
      // handled cleanly via syncMsg on explicit sync
    }
  };

  const loadOrders = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ orders: Order[] }>('/api/orders');
      setOrders(res.orders);
      if (fbUser) {
        await syncPastRecordsToFirestore({
          appUser: user,
          orders: res.orders,
          fbUser,
        }).catch(() => {});
        await loadVault(fbUser);
      }
    } catch {
      // handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [user?.id, fbUser?.uid]);

  useEffect(() => {
    if (fbUser && !user) {
      loadVault(fbUser);
    }
  }, [fbUser?.uid]);

  const handleConnectAndSync = async () => {
    setSyncMsg(null);
    setSyncBusy(true);
    try {
      const activeFbUser = fbUser || (await signInWithGoogleFirebase());
      if (user) {
        let farmerListings: ProduceListing[] = [];
        if (user.role === 'farmer') {
          const lRes = await apiFetch<{ listings: ProduceListing[] }>('/api/farmer/listings').catch(
            () => ({ listings: [] })
          );
          farmerListings = lRes.listings;
        } else {
          const mRes = await apiFetch<{ listings: ProduceListing[] }>(
            `/api/listings?city=${encodeURIComponent(user.city || 'Pune')}`
          ).catch(() => ({ listings: [] }));
          farmerListings = mRes.listings.slice(0, 6);
        }

        await syncPastRecordsToFirestore({
          appUser: user,
          orders,
          listings: farmerListings,
          fbUser: activeFbUser,
        });
      }
      const nextVault = await fetchFirestoreVault(activeFbUser);
      setVault(nextVault);
      setSyncMsg(
        language === 'mr'
          ? `Firebase (${FIREBASE_PROJECT_ID}) वर ग्राहक, शेतकरी, फोटो व मागील ऑर्डर्स सुरक्षित सिंक झाले!`
          : `Synced profiles, uploaded photos & past orders to Cloud Firestore (${FIREBASE_PROJECT_ID}).`
      );
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Firebase sync failed');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
      if (fbUser) {
        await updateOrderStatusInFirestore(orderId, 'cancelled', fbUser).catch(() => {});
      }
      setFeedback(language === 'mr' ? 'ऑर्डर यशस्वीरित्या रद्द केली.' : 'Order cancelled successfully.');
      loadOrders();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Unable to cancel order.');
    }
  };

  const handlePayNow = async (orderId: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/orders/${orderId}/pay`, {
        method: 'POST',
        body: JSON.stringify({ paymentMethod: 'UPI' }),
      });
      if (fbUser) {
        await payOrderInFirestore(orderId, fbUser).catch(() => {});
      }
      setFeedback(language === 'mr' ? 'UPI पेमेंट पूर्ण झाले.' : 'UPI Payment confirmed.');
      loadOrders();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Payment error');
    }
  };

  const handleSubmitRating = async (orderId: string) => {
    const draft = ratingDrafts[orderId] || { farmerScore: 5, deliveryScore: 5, review: '' };
    setFeedback(null);
    try {
      await apiFetch(`/api/orders/${orderId}/rate`, {
        method: 'POST',
        body: JSON.stringify({
          ratingScore: draft.farmerScore,
          deliveryRatingScore: draft.deliveryScore,
          ratingReview: draft.review,
        }),
      });
      if (fbUser) {
        await rateOrderInFirestore(
          orderId,
          draft.farmerScore,
          draft.deliveryScore,
          draft.review,
          fbUser
        ).catch(() => {});
      }
      setFeedback(
        language === 'mr'
          ? 'रेटिंग व अभिप्राय नोंदवला गेला. धन्यवाद!'
          : 'Farmer & delivery ratings saved. Thank you!'
      );
      loadOrders();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not save rating');
    }
  };

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t(language, 'backHome')}</span>
          </button>
          <h1 className="text-xl font-bold text-slate-900">{t(language, 'navOrders')}</h1>
        </div>

        {user && (
          <button
            type="button"
            onClick={loadOrders}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{language === 'mr' ? 'रिफ्रेश करा' : 'Refresh Live Tracking'}</span>
          </button>
        )}
      </div>

      {/* Firebase Cloud Archive & Sync Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-emerald-800" />
              <h2 className="text-sm font-semibold text-slate-900">
                {language === 'mr'
                  ? `Firebase क्लाउड स्टोरेज (${FIREBASE_PROJECT_ID})`
                  : `Firebase Cloud Firestore Archive (${FIREBASE_PROJECT_ID})`}
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              {fbUser
                ? language === 'mr'
                  ? `जोडलेले खाते: ${fbUser.email || fbUser.uid} · ग्राहक, शेतकरी, फोटो आणि मागील ऑर्डर्स सुरक्षित जतन केले जातात.`
                  : `Connected as ${fbUser.email || fbUser.uid} · Stores customer profiles, farmer profiles, uploaded timestamped photos & past orders.`
                : language === 'mr'
                ? 'ग्राहक, शेतकरी डेटा, लाइव्ह फोटो आणि मागील ऑर्डर्स तुमच्या Firebase मध्ये जतन करण्यासाठी Google ने जोडा.'
                : 'Connect your Google account to sync customer data, farmer data, uploaded live photos, and past orders to your Firebase Firestore database.'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleConnectAndSync}
            disabled={syncBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            <Cloud className="h-4 w-4" />
            <span>
              {syncBusy
                ? '...'
                : fbUser
                ? language === 'mr'
                  ? 'आता Firebase वर सिंक करा'
                  : 'Sync Past Orders & Photos Now'
                : language === 'mr'
                ? 'Google ने Firebase जोडा'
                : 'Connect Google & Sync to Firebase'}
            </span>
          </button>
        </div>

        {syncMsg && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{syncMsg}</span>
          </div>
        )}

        {fbUser && vault && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Customers</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {vault.profiles.filter((p) => p.role === 'customer').length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Farmers</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {vault.profiles.filter((p) => p.role === 'farmer').length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Delivery Agents</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {vault.profiles.filter((p) => p.role === 'delivery').length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Sign-In Logs</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {vault.signIns.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Uploaded Photos</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {vault.uploadedPhotos.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Orders Stored</p>
                <p className="mt-1 font-mono text-lg font-bold text-emerald-900 tabular-nums">
                  {vault.orders.length}
                </p>
              </div>
            </div>

            {vault.signIns.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  Recent Sign-In Records Stored in Firestore
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {vault.signIns.slice(0, 4).map((si, idx) => (
                    <div
                      key={String(si.id || idx)}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div className="truncate">
                        <span className="font-semibold text-slate-900">{String(si.name || '')}</span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="capitalize font-medium text-emerald-800">
                          {String(si.role || 'customer')}
                        </span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="text-slate-500">{String(si.city || '')}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0 ml-2">
                        {String(si.authMethod || 'google')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vault.uploadedPhotos.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5 text-emerald-800" />
                  <span>Uploaded Photos Synced in Firestore</span>
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {vault.uploadedPhotos.slice(0, 4).map((photo, idx) => (
                    <div
                      key={String(photo.id || idx)}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                    >
                      <img
                        src={String(photo.photoDataUrl || '')}
                        alt={String(photo.note || 'Farm photo')}
                        referrerPolicy="no-referrer"
                        className="h-20 w-full object-cover"
                      />
                      <p className="truncate px-2 py-1 text-[11px] text-slate-600">
                        {String(photo.note || photo.photoType || 'Verified batch')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {feedback && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
          {feedback}
        </div>
      )}

      {!user ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-4">
          <p className="text-sm text-slate-600">
            {language === 'mr'
              ? 'तुमच्या ऑर्डर ट्रॅक करण्यासाठी कृपया SMS OTP ने साइन इन करा.'
              : 'Sign in with your mobile number to view live order location, cancellation deadlines, and ratings.'}
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            {t(language, 'signInRegister')}
          </button>
        </div>
      ) : loading ? (
        <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <p className="text-sm text-slate-600">
            {language === 'mr' ? 'अद्याप कोणतीही ऑर्डर नाही.' : 'No bulk orders placed yet.'}
          </p>
          <button
            type="button"
            onClick={onBackHome}
            className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
          >
            {t(language, 'navMarketplace')}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const canCancel =
              (order.status === 'placed' || order.status === 'accepted_by_farmer') &&
              Date.now() < new Date(order.cancellationDeadlineAt).getTime();

            const draft = ratingDrafts[order.id] || {
              farmerScore: 5,
              deliveryScore: 5,
              review: '',
            };

            return (
              <div
                key={order.id}
                className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <img
                      src={resolveProduceImage(order.livePhotoUrl, order.productKey)}
                      alt={order.productNameEn}
                      referrerPolicy="no-referrer"
                      className="h-16 w-20 rounded-lg object-cover border border-slate-200"
                    />
                    <div>
                      <p className="font-mono text-xs text-slate-500 tabular-nums">
                        {order.orderCode} · {order.status.replace(/_/g, ' ')} · Payment:{' '}
                        {order.paymentStatus} ({order.paymentMethod})
                      </p>
                      <h2 className="mt-0.5 text-lg font-bold text-slate-900">
                        {language === 'mr' ? order.productNameMr : order.productNameEn} —{' '}
                        <span className="font-mono tabular-nums">{order.quantityKg} kg</span>
                      </h2>
                      <p className="text-xs text-slate-600">
                        {order.farmName} ({order.farmerName}) · Delivery scheduled:{' '}
                        {new Date(order.scheduledDeliveryAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-xl font-bold text-slate-900 tabular-nums">
                      ₹{order.totalAmount.toLocaleString('en-IN')}
                    </p>
                    <p className="text-xs font-mono text-emerald-800 tabular-nums">
                      ₹{order.pricePerKg}/kg (Mandi ₹{order.mandiPricePerKg}/kg)
                    </p>
                  </div>
                </div>

                {/* Live Location Map & ETA */}
                {order.status !== 'cancelled' && (
                  <LiveTrackMap order={order} language={language} />
                )}

                {/* Order Actions: Cancel Window / Pay / Rate */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                  <div className="text-xs text-slate-600">
                    {order.status === 'cancelled' ? (
                      <span className="font-medium text-red-700">
                        {language === 'mr' ? 'ही ऑर्डर रद्द झाली आहे.' : 'This order was cancelled.'}
                      </span>
                    ) : (
                      <span>
                        {t(language, 'cancellationPolicy')}:{' '}
                        <strong className="text-slate-900">
                          {order.cancellationCutoffHours}h before dispatch
                        </strong>{' '}
                        ({new Date(order.cancellationDeadlineAt).toLocaleString('en-IN')})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {order.paymentStatus === 'Pending' && order.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => handlePayNow(order.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        <span>{language === 'mr' ? 'UPI ने पैसे भरा' : 'Pay Now via UPI'}</span>
                      </button>
                    )}

                    {(order.status === 'placed' || order.status === 'accepted_by_farmer') && (
                      <button
                        type="button"
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={!canCancel}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>{t(language, 'cancelOrder')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Post-Delivery Rating & Review */}
                {order.status === 'delivered' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                    {order.ratingScore ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-slate-900">
                          Your Rating: {order.ratingScore}/5 ★ Farmer · {order.deliveryRatingScore}/5 ★ Delivery
                        </span>
                        <span className="text-slate-600 italic">"{order.ratingReview}"</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-slate-900">
                          {t(language, 'rateOrder')}
                        </p>
                        <div className="flex flex-wrap items-center gap-6">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-600">Farmer Quality:</span>
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() =>
                                  setRatingDrafts((prev) => ({
                                    ...prev,
                                    [order.id]: { ...draft, farmerScore: s },
                                  }))
                                }
                                className="p-0.5"
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    s <= draft.farmerScore
                                      ? 'fill-amber-500 text-amber-500'
                                      : 'text-slate-300'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-600">Delivery Partner:</span>
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() =>
                                  setRatingDrafts((prev) => ({
                                    ...prev,
                                    [order.id]: { ...draft, deliveryScore: s },
                                  }))
                                }
                                className="p-0.5"
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    s <= draft.deliveryScore
                                      ? 'fill-emerald-700 text-emerald-700'
                                      : 'text-slate-300'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={draft.review}
                            onChange={(e) =>
                              setRatingDrafts((prev) => ({
                                ...prev,
                                [order.id]: { ...draft, review: e.target.value },
                              }))
                            }
                            placeholder={
                              language === 'mr'
                                ? 'मालाच्या गुणवत्तेबद्दल अभिप्राय लिहा...'
                                : 'Share quality feedback for other bulk buyers...'
                            }
                            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-emerald-700 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSubmitRating(order.id)}
                            className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                          >
                            {language === 'mr' ? 'रेटिंग सबमिट करा' : 'Submit Rating'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
