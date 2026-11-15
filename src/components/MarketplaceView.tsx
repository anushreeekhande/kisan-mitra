import React, { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  Search,
  MapPin,
  Star,
  Clock,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Bot,
  ShieldCheck,
  TrendingDown,
  Truck,
  Bell,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  syncOrderToFirestore,
  syncPriceAlertToFirestore,
  deletePriceAlertFromFirestore,
} from '../lib/firebase';
import { t } from '../lib/i18n';
import { HERO_HARVEST_IMAGE, resolveProduceImage } from '../lib/images';
import type {
  CityHub,
  Language,
  MandiPrice,
  Order,
  PhotoVerification,
  PriceAlert,
  PriceNotification,
  ProduceListing,
  User,
} from '../types';

interface MarketplaceViewProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  user: User | null;
  fbUser?: FirebaseUser | null;
  cities: CityHub[];
  selectedCity: string;
  onCityChange: (city: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedListing: ProduceListing | null;
  onSelectListing: (listing: ProduceListing | null) => void;
  onOpenAuth: () => void;
  onOpenAiWithPrompt: (prompt: string) => void;
  onOrderCreated: () => void;
}

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  language,
  onLanguageChange,
  user,
  fbUser,
  cities,
  selectedCity,
  onCityChange,
  searchQuery,
  onSearchChange,
  selectedListing,
  onSelectListing,
  onOpenAuth,
  onOpenAiWithPrompt,
  onOrderCreated,
}) => {
  const [category, setCategory] = useState<'All' | 'Vegetables' | 'Fruits' | 'Leafy Greens'>('All');
  const [sortBy, setSortBy] = useState<'nearest' | 'price_asc' | 'rating_desc' | 'savings_desc'>('nearest');
  const [listings, setListings] = useState<ProduceListing[]>([]);
  const [mandiPrices, setMandiPrices] = useState<MandiPrice[]>([]);
  const [mandiName, setMandiName] = useState('');
  const [loading, setLoading] = useState(true);

  // Detail / Checkout state
  const [pvStatus, setPvStatus] = useState<{
    priorOrdersCount: number;
    isFirstOrderWithFarmer: boolean;
    verification: PhotoVerification | null;
  } | null>(null);
  const [qtyKg, setQtyKg] = useState<number>(50);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Bank Transfer' | 'Bulk COD'>('UPI');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryHoursFromNow, setDeliveryHoursFromNow] = useState<number>(18);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutMsg, setCheckoutMsg] = useState<{ type: 'error' | 'ok'; text: string } | null>(null);

  // Price drop subscriptions & notifications
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [notifications, setNotifications] = useState<PriceNotification[]>([]);
  const [alertTargetInput, setAlertTargetInput] = useState<number>(20);
  const [alertProductKey, setAlertProductKey] = useState<string>('tomato');
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const loadPriceAlerts = async () => {
    if (!user) {
      setPriceAlerts([]);
      setNotifications([]);
      return;
    }
    try {
      const res = await apiFetch<{ alerts: PriceAlert[]; notifications: PriceNotification[] }>(
        '/api/price-alerts'
      );
      setPriceAlerts(res.alerts);
      setNotifications(res.notifications);
    } catch {
      // ignore cleanly
    }
  };

  const loadMarketplace = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        city: selectedCity,
        search: searchQuery,
        category,
        sort: sortBy,
      });
      const [listRes, mandiRes] = await Promise.all([
        apiFetch<{ city: string; mandiName: string; listings: ProduceListing[] }>(
          `/api/listings?${params.toString()}`
        ),
        apiFetch<{ city: string; prices: MandiPrice[] }>(
          `/api/mandi-prices?city=${encodeURIComponent(selectedCity)}&search=${encodeURIComponent(searchQuery)}`
        ),
      ]);
      setListings(listRes.listings);
      setMandiName(listRes.mandiName);
      setMandiPrices(mandiRes.prices);
    } catch {
      // handled cleanly via empty state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMarketplace();
  }, [selectedCity, searchQuery, category, sortBy]);

  useEffect(() => {
    loadPriceAlerts();
  }, [user?.id]);

  const handleSubscribePriceAlert = async (
    productKey: string,
    productNameEn: string,
    productNameMr: string,
    targetPrice: number
  ) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setAlertMsg(null);
    try {
      const res = await apiFetch<{ alert?: PriceAlert; immediateMatches: number }>(
        '/api/price-alerts',
        {
          method: 'POST',
          body: JSON.stringify({
            productKey,
            productNameEn,
            productNameMr,
            city: selectedCity,
            targetPricePerKg: targetPrice,
          }),
        }
      );
      if (fbUser && res.alert) {
        syncPriceAlertToFirestore(
          {
            ...res.alert,
            isActive: Boolean(res.alert.isActive),
          },
          fbUser
        ).catch(() => {});
      }
      setAlertMsg(
        res.immediateMatches > 0
          ? `Subscribed to ${productNameEn} <= ₹${targetPrice}/kg — ${res.immediateMatches} matching farmer batch found right now!`
          : `Subscribed! You will be notified whenever a farmer lists ${productNameEn} at or below ₹${targetPrice}/kg.`
      );
      loadPriceAlerts();
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : 'Could not create alert');
    }
  };

  const handleDeletePriceAlert = async (alertId: string) => {
    await apiFetch(`/api/price-alerts/${alertId}`, { method: 'DELETE' }).catch(() => {});
    if (fbUser) {
      deletePriceAlertFromFirestore(alertId, fbUser).catch(() => {});
    }
    loadPriceAlerts();
  };

  const handleMarkNotificationRead = async (id?: string) => {
    await apiFetch('/api/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify(id ? { id } : {}),
    }).catch(() => {});
    loadPriceAlerts();
  };

  useEffect(() => {
    if (!selectedListing) {
      setPvStatus(null);
      setCheckoutMsg(null);
      return;
    }
    setQtyKg(selectedListing.minOrderKg);
    setDeliveryAddress(
      user?.area ? `${user.area}, ${selectedCity}` : `Main Commercial Market, ${selectedCity}`
    );
    setCheckoutMsg(null);
    apiFetch<{
      priorOrdersCount: number;
      isFirstOrderWithFarmer: boolean;
      verification: PhotoVerification | null;
    }>(`/api/photo-verifications/status?listingId=${encodeURIComponent(selectedListing.id)}`)
      .then((res) => setPvStatus(res))
      .catch(() => {});
  }, [selectedListing, user?.id]);

  const handleRequestLivePhoto = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!selectedListing) return;
    setCheckoutBusy(true);
    setCheckoutMsg(null);
    try {
      const res = await apiFetch<{ verification: PhotoVerification }>(
        '/api/photo-verifications/request',
        {
          method: 'POST',
          body: JSON.stringify({ listingId: selectedListing.id }),
        }
      );
      setPvStatus((prev) =>
        prev
          ? { ...prev, verification: res.verification }
          : { priorOrdersCount: 0, isFirstOrderWithFarmer: true, verification: res.verification }
      );
      setCheckoutMsg({
        type: 'ok',
        text:
          language === 'mr'
            ? 'शेतकऱ्याला लाइव्ह फोटोची विनंती पाठवली आहे. शेतकरी पोर्टलवरून फोटो पाठवल्यानंतर ऑर्डर करता येईल.'
            : 'Live photo request sent to the farmer. Once the farmer captures & sends the timestamped photo, you can place the order.',
      });
    } catch (err) {
      setCheckoutMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not send photo request',
      });
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onOpenAuth();
      return;
    }
    if (user.role !== 'customer') {
      setCheckoutMsg({
        type: 'error',
        text:
          language === 'mr'
            ? 'घाऊक ऑर्डर देण्यासाठी कृपया ग्राहक (Customer) म्हणून साइन इन करा.'
            : 'Please sign in with a Customer account to place bulk orders.',
      });
      return;
    }
    if (!selectedListing) return;

    setCheckoutBusy(true);
    setCheckoutMsg(null);
    try {
      const scheduledIso = new Date(Date.now() + deliveryHoursFromNow * 3600_000).toISOString();
      const res = await apiFetch<{ order: Order }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          listingId: selectedListing.id,
          quantityKg: qtyKg,
          paymentMethod,
          scheduledDeliveryAt: scheduledIso,
          deliveryAddress,
          deliveryCity: selectedCity,
        }),
      });
      if (fbUser && res.order) {
        await syncOrderToFirestore(res.order, fbUser).catch(() => {});
      }
      onOrderCreated();
    } catch (err) {
      setCheckoutMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Order failed',
      });
    } finally {
      setCheckoutBusy(false);
    }
  };

  // ========================================================
  // DETAIL / BULK CHECKOUT VIEW (with Back to Homepage button)
  // ========================================================
  if (selectedListing) {
    const productName =
      language === 'mr' ? selectedListing.productNameMr : selectedListing.productNameEn;
    const isVerifiedSent = pvStatus?.verification?.status === 'sent';
    const isPendingPhoto = pvStatus?.verification?.status === 'pending';
    const isFirstOrder = pvStatus?.isFirstOrderWithFarmer ?? true;
    const canOrder = user?.role === 'customer' && (!isFirstOrder || isVerifiedSent);

    const activePhotoUrl =
      isVerifiedSent && pvStatus?.verification?.photoDataUrl
        ? pvStatus.verification.photoDataUrl
        : selectedListing.livePhotoUrl;
    const activePhotoTs =
      isVerifiedSent && pvStatus?.verification?.photoTimestamp
        ? pvStatus.verification.photoTimestamp
        : selectedListing.livePhotoTimestamp;

    const scheduledPreview = new Date(Date.now() + deliveryHoursFromNow * 3600_000);
    const cancelDeadlinePreview = new Date(
      scheduledPreview.getTime() - selectedListing.cancellationCutoffHours * 3600_000
    );
    const totalPrice = Math.round(qtyKg * selectedListing.pricePerKg);
    const totalMandiEquivalent = Math.round(
      qtyKg * (selectedListing.mandiModalPrice || selectedListing.pricePerKg)
    );
    const totalSaved = Math.max(0, totalMandiEquivalent - totalPrice);

    return (
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <button
            type="button"
            onClick={() => onSelectListing(null)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t(language, 'backHome')}</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                handleSubscribePriceAlert(
                  selectedListing.productKey,
                  selectedListing.productNameEn,
                  selectedListing.productNameMr,
                  Math.max(5, selectedListing.pricePerKg - 2)
                )
              }
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <Bell className="h-4 w-4 text-emerald-800" />
              <span>
                {t(language, 'subscribePriceDrop')} (≤ ₹{Math.max(5, selectedListing.pricePerKg - 2)}/kg)
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onOpenAiWithPrompt(
                  `Compare ${selectedListing.farmerName} (${selectedListing.farmName}) selling ${selectedListing.productNameEn} at ₹${selectedListing.pricePerKg}/kg with other farmers and today's ${selectedCity} mandi rate.`
                )
              }
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-50"
            >
              <Bot className="h-4 w-4" />
              <span>
                {language === 'mr'
                  ? 'AI कडून तुलना व मंडी भाव पहा'
                  : 'Compare with AI Advisor'}
              </span>
            </button>
          </div>
        </div>

        {alertMsg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {alertMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Live Photo & Mandi Comparison */}
          <div className="lg:col-span-7 space-y-6">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="aspect-[4/3] w-full bg-slate-100 relative">
                <img
                  src={resolveProduceImage(activePhotoUrl, selectedListing.productKey)}
                  alt={productName}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-900">
                  <Camera className="h-4 w-4" />
                  {isVerifiedSent
                    ? language === 'mr'
                      ? 'शेतकऱ्याने आत्ताच पाठवलेला लाइव्ह फोटो'
                      : 'Fresh Buyer-Verified Live Farm Photo'
                    : t(language, 'livePhotoCaptured')}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  {new Date(activePhotoTs).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Farmer & Batch Details */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {selectedListing.category} · {selectedListing.variety} · {selectedListing.qualityGrade}
                  </p>
                  <h1 className="mt-1 text-2xl font-bold text-slate-900">{productName}</h1>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedListing.farmName} ({selectedListing.farmerName}) · {selectedListing.farmerArea},{' '}
                    {selectedListing.farmerCity}
                  </p>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 tabular-nums">
                    <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                    <span>{selectedListing.farmerRatingAvg.toFixed(1)}</span>
                    <span className="text-slate-500 font-normal">
                      ({selectedListing.farmerRatingCount})
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-mono text-slate-600 tabular-nums">
                    {selectedListing.distanceKm} km away
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-700 leading-relaxed">{selectedListing.description}</p>

              {/* Transparent Price Benchmark Table */}
              <div className="grid grid-cols-3 gap-3 border-t border-slate-200 pt-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{t(language, 'farmerPrice')}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-emerald-900 tabular-nums">
                    ₹{selectedListing.pricePerKg}/kg
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">
                    {selectedCity} {t(language, 'mandiPriceToday')}
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold text-slate-700 line-through tabular-nums">
                    ₹{selectedListing.mandiModalPrice}/kg
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="text-xs text-emerald-800">{t(language, 'youSave')}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-emerald-900 tabular-nums">
                    {selectedListing.savingsPercent}%
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                {selectedListing.mandiName} · Range ₹{selectedListing.mandiMinPrice}–₹
                {selectedListing.mandiMaxPrice}/kg today
              </p>
            </div>
          </div>

          {/* Right Column: Live Photo Rule & Bulk Checkout Module */}
          <div className="lg:col-span-5 space-y-5">
            {/* Pre-Order Real-time Photo Verification Box */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-start gap-3">
                <Camera className="h-5 w-5 text-emerald-800 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {language === 'mr'
                      ? 'ऑर्डरपूर्वी शेतकऱ्याचा लाइव्ह फोटो नियम'
                      : 'Pre-Order Live Photo Verification'}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {!user
                      ? language === 'mr'
                        ? 'प्रथम ग्राहक म्हणून लॉगिन करा. पहिल्या ऑर्डरसाठी शेतकऱ्याचा थेट फोटो आवश्यक आहे.'
                        : 'Sign in as a Customer to verify order history. First-time orders with a farmer require a fresh timestamped photo before checkout.'
                      : isFirstOrder
                      ? t(language, 'firstOrderPhotoNotice')
                      : t(language, 'repeatOrderPhotoNotice')}
                  </p>
                </div>
              </div>

              {user?.role === 'customer' && (
                <div className="pt-1">
                  {isVerifiedSent ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-900">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                        <span>{t(language, 'photoVerifiedMsg')}</span>
                      </div>
                      {!isFirstOrder && (
                        <button
                          type="button"
                          onClick={handleRequestLivePhoto}
                          disabled={checkoutBusy}
                          className="text-xs font-medium text-emerald-800 hover:underline"
                        >
                          {t(language, 'askFreshPhoto')}
                        </button>
                      )}
                    </div>
                  ) : isPendingPhoto ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900">
                      <span className="flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0" />
                        {t(language, 'photoPendingMsg')}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          apiFetch<{
                            priorOrdersCount: number;
                            isFirstOrderWithFarmer: boolean;
                            verification: PhotoVerification | null;
                          }>(`/api/photo-verifications/status?listingId=${selectedListing.id}`).then(
                            setPvStatus
                          )
                        }
                        className="font-semibold underline shrink-0"
                      >
                        {language === 'mr' ? 'तपासा' : 'Refresh'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRequestLivePhoto}
                      disabled={checkoutBusy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-800 bg-white px-4 py-2.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                    >
                      <Camera className="h-4 w-4" />
                      <span>
                        {isFirstOrder
                          ? t(language, 'requestLivePhoto')
                          : t(language, 'askFreshPhoto')}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Bulk Order Form */}
            <form
              onSubmit={handlePlaceOrder}
              className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-slate-900">
                {language === 'mr' ? 'घाऊक ऑर्डर तपशील' : 'Bulk Order Summary'}
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {language === 'mr' ? 'प्रमाण (किलो)' : 'Quantity (kg)'}
                  </label>
                  <input
                    type="number"
                    min={selectedListing.minOrderKg}
                    max={selectedListing.availableKg}
                    value={qtyKg}
                    onChange={(e) => setQtyKg(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums focus:border-emerald-700 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500 tabular-nums">
                    Min {selectedListing.minOrderKg} kg · Max {selectedListing.availableKg} kg
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {language === 'mr' ? 'डिलिव्हरी वेळ' : 'Scheduled Dispatch'}
                  </label>
                  <select
                    value={deliveryHoursFromNow}
                    onChange={(e) => setDeliveryHoursFromNow(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-emerald-700 focus:outline-none"
                  >
                    <option value={6}>Today (+6 hrs)</option>
                    <option value={18}>Tomorrow Morning (+18 hrs)</option>
                    <option value={24}>Tomorrow Afternoon (+24 hrs)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {language === 'mr' ? 'डिलिव्हरी पत्ता' : 'Delivery Address'}
                </label>
                <input
                  type="text"
                  required
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {language === 'mr' ? 'पेमेंट पद्धत' : 'Payment Method'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['UPI', 'Bank Transfer', 'Bulk COD'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                        paymentMethod === method
                          ? 'border-emerald-800 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              {/* Farmer-decided Cancellation Window Notice */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-emerald-800" />
                  <span>{t(language, 'cancellationPolicy')}</span>
                </div>
                <p>
                  {language === 'mr'
                    ? `शेतकऱ्याने ठरवलेली मर्यादा: पाठवण्यापूर्वी किमान ${selectedListing.cancellationCutoffHours} तास आधी रद्द करता येईल (${cancelDeadlinePreview.toLocaleString('en-IN')}).`
                    : `Farmer allows free cancellation up to ${selectedListing.cancellationCutoffHours} hrs before dispatch (until ${cancelDeadlinePreview.toLocaleString('en-IN')}).`}
                </p>
              </div>

              {/* Totals */}
              <div className="border-t border-slate-200 pt-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>{language === 'mr' ? 'मंडी तुलनात्मक किंमत' : 'APMC Mandi Equivalent'}</span>
                  <span className="font-mono line-through tabular-nums">
                    ₹{totalMandiEquivalent.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-800 font-medium">
                  <span>{t(language, 'youSave')}</span>
                  <span className="font-mono tabular-nums">
                    ₹{totalSaved.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold text-slate-900 pt-1">
                  <span>{language === 'mr' ? 'एकूण देय रक्कम' : 'Direct Farm Total'}</span>
                  <span className="font-mono tabular-nums">
                    ₹{totalPrice.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {checkoutMsg && (
                <div
                  className={`rounded-lg border px-3 py-2.5 text-xs ${
                    checkoutMsg.type === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  {checkoutMsg.text}
                </div>
              )}

              {!user ? (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="w-full rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900"
                >
                  {t(language, 'signInRegister')}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={checkoutBusy || !canOrder}
                  className="w-full rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checkoutBusy
                    ? '...'
                    : isFirstOrder && !isVerifiedSent
                    ? language === 'mr'
                      ? 'प्रथम शेतकऱ्याचा लाइव्ह फोटो आवश्यक आहे'
                      : 'Waiting for Farmer Live Photo Verification'
                    : t(language, 'placeBulkOrder')}
                </button>
              )}
            </form>
          </div>
        </div>
      </section>
    );
  }

  // ========================================================
  // MAIN HOMEPAGE MARKETPLACE
  // ========================================================
  const nearestListing = listings[0] || null;

  return (
    <div className="space-y-10 pb-12">
      {/* 1. Split Hero Banner */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 px-4 sm:px-8 py-10 lg:py-14 flex flex-col justify-center space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold tracking-wide text-emerald-800">
                {t(language, 'bulkOnlyNote')}
              </p>
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => onLanguageChange('en')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    language === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => onLanguageChange('mr')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    language === 'mr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  मराठी
                </button>
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-slate-900 leading-[1.12] [text-wrap:balance]">
              {t(language, 'heroTitle')}
            </h1>
            <p className="max-w-2xl text-base text-slate-600 leading-relaxed">
              {t(language, 'heroSubtitle')}
            </p>

            {/* Primary Search & City Hub Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
              <div className="sm:col-span-4">
                <label className="sr-only">{t(language, 'yourCityMandi')}</label>
                <div className="flex items-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5">
                  <MapPin className="h-4 w-4 text-emerald-800 shrink-0 mr-2" />
                  <select
                    value={selectedCity}
                    onChange={(e) => onCityChange(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium text-slate-900 focus:outline-none"
                  >
                    {cities.map((c) => (
                      <option key={c.city} value={c.city}>
                        {c.city} Mandi
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-8">
                <div className="flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 focus-within:border-emerald-800">
                  <Search className="h-4 w-4 text-slate-400 shrink-0 mr-2.5" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={t(language, 'searchPlaceholder')}
                    className="w-full text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Suggest AI Bot for Today's Mandi Price whenever searching */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2.5 text-xs text-slate-700">
                <Bot className="h-4 w-4 text-emerald-800 shrink-0" />
                <span>
                  {searchQuery.trim()
                    ? language === 'mr'
                      ? `"${searchQuery}" साठी आजचा ${selectedCity} बाजार भाव व शेतकरी तुलना पहा`
                      : `Searching "${searchQuery}" — Check today's ${selectedCity} mandi rate & compare farmers`
                    : t(language, 'checkMandiWithAi')}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onOpenAiWithPrompt(
                    searchQuery.trim()
                      ? `What is today's standard mandi price for ${searchQuery} in ${selectedCity}? Also compare the available farmers on quality, distance, and reviews.`
                      : `Show today's mandi prices in ${selectedCity} and compare our top nearest farmers by quality, distance, and reviews.`
                  )
                }
                className="text-xs font-semibold text-emerald-900 hover:underline whitespace-nowrap shrink-0"
              >
                {t(language, 'askLiveAi')} →
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 min-h-[260px] lg:min-h-full bg-slate-100">
            <img
              src={HERO_HARVEST_IMAGE}
              alt="Fresh farm harvest crates ready for bulk dispatch"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* 2. Today's Official APMC Mandi Benchmark Strip */}
      <section className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {language === 'mr'
                  ? `आजचे प्रमाणित बाजार भाव — ${mandiName || selectedCity}`
                  : `Today's Standard APMC Mandi Rates — ${mandiName || selectedCity}`}
              </h2>
              <p className="text-xs text-slate-500">
                {language === 'mr'
                  ? 'दररोजचे अधिकृत मंडी दर विरुद्ध किसान मित्र थेट शेतकरी दर'
                  : 'Official daily city mandi wholesale benchmarks compared live against direct farm listings'}
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            {mandiPrices.map((mp) => (
              <button
                key={mp.id}
                type="button"
                onClick={() => onSearchChange(mp.productNameEn.split(' ').pop() || mp.productKey)}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:border-emerald-700 hover:bg-white transition-colors"
              >
                <p className="text-xs font-medium text-slate-900 truncate">
                  {language === 'mr' ? mp.productNameMr : mp.productNameEn}
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-slate-900 tabular-nums">
                  ₹{mp.modalPricePerKg}/kg
                </p>
                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                  ₹{mp.minPricePerKg}–₹{mp.maxPricePerKg}
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 2B. Customer Price-Drop Subscriptions & Live Notifications */}
      <section className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-emerald-800" />
              <h2 className="text-base font-semibold text-slate-900">
                {t(language, 'priceDropAlerts')}
              </h2>
              <span className="text-xs text-slate-500">
                ·{' '}
                {language === 'mr'
                  ? 'शेतकऱ्याचा दर तुमच्या लक्ष्यापेक्षा कमी होताच सूचना मिळवा'
                  : 'Get notified whenever a farmer lists or drops a price below your target'}
              </span>
            </div>

            {notifications.some((n) => !n.isRead) && (
              <button
                type="button"
                onClick={() => handleMarkNotificationRead()}
                className="text-xs font-medium text-emerald-800 hover:underline"
              >
                {language === 'mr' ? 'सर्व वाचलेले करा' : 'Mark All Read'}
              </button>
            )}
          </div>

          {/* Unread / Recent Price Drop Notifications */}
          {notifications.length > 0 && (
            <div className="space-y-2">
              {notifications.slice(0, 4).map((notif) => (
                <div
                  key={notif.id}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
                    notif.isRead
                      ? 'border-slate-200 bg-slate-50 text-slate-600'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  }`}
                >
                  <div>
                    <p className="font-semibold">{notif.title}</p>
                    <p className="mt-0.5">{notif.message}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {notif.listingId && (
                      <button
                        type="button"
                        onClick={() => {
                          const found = listings.find((l) => l.id === notif.listingId);
                          if (found) onSelectListing(found);
                          else onSearchChange(notif.productKey);
                          handleMarkNotificationRead(notif.id);
                        }}
                        className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900"
                      >
                        {language === 'mr' ? 'डिल पहा' : 'View Deal'}
                      </button>
                    )}
                    {!notif.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkNotificationRead(notif.id)}
                        className="font-medium underline"
                      >
                        {language === 'mr' ? 'वाचले' : 'Dismiss'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Subscribe Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const mp = mandiPrices.find((m) => m.productKey === alertProductKey);
              handleSubscribePriceAlert(
                alertProductKey,
                mp?.productNameEn || alertProductKey,
                mp?.productNameMr || alertProductKey,
                alertTargetInput
              );
            }}
            className="flex flex-wrap items-end gap-3 pt-1"
          >
            <div className="min-w-[180px] flex-1">
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                {language === 'mr' ? 'भाजी / फळ निवडा' : 'Produce Item'}
              </label>
              <select
                value={alertProductKey}
                onChange={(e) => setAlertProductKey(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                {mandiPrices.map((mp) => (
                  <option key={mp.productKey} value={mp.productKey}>
                    {language === 'mr' ? mp.productNameMr : mp.productNameEn} (Mandi ₹{mp.modalPricePerKg}/kg)
                  </option>
                ))}
              </select>
            </div>

            <div className="w-40">
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                {t(language, 'targetPricePlaceholder')}
              </label>
              <input
                type="number"
                required
                min={5}
                value={alertTargetInput}
                onChange={(e) => setAlertTargetInput(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs tabular-nums focus:border-emerald-700 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 whitespace-nowrap"
            >
              {t(language, 'subscribePriceDrop')}
            </button>
          </form>

          {alertMsg && (
            <p className="text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {alertMsg}
            </p>
          )}

          {/* Active Subscriptions List */}
          {priceAlerts.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <span className="font-medium text-slate-700">
                {language === 'mr' ? 'तुमचे सक्रिय अलर्ट:' : 'Active Subscriptions:'}
              </span>
              {priceAlerts.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1 bg-slate-50 font-mono tabular-nums"
                >
                  <span className="font-sans font-medium text-slate-900">
                    {language === 'mr' ? a.productNameMr : a.productNameEn}
                  </span>
                  <span>≤ ₹{a.targetPricePerKg}/kg</span>
                  <button
                    type="button"
                    onClick={() => handleDeletePriceAlert(a.id)}
                    aria-label="Remove alert"
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3. Filter, Nearest Farmer Spotlight & Sorted Bulk Listings Grid */}
      <section className="mx-auto max-w-7xl px-4 sm:px-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          {/* Category Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'All', label: t(language, 'allCategories') },
                { id: 'Vegetables', label: t(language, 'vegetables') },
                { id: 'Fruits', label: t(language, 'fruits') },
                { id: 'Leafy Greens', label: t(language, 'leafyGreens') },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  category === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">{t(language, 'sortBy')}:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-700 focus:outline-none"
            >
              <option value="nearest">{t(language, 'sortNearest')}</option>
              <option value="price_asc">{t(language, 'sortPrice')}</option>
              <option value="rating_desc">{t(language, 'sortRating')}</option>
              <option value="savings_desc">{t(language, 'sortSavings')}</option>
            </select>
          </div>
        </div>

        {/* Nearest Farmer Callout Strip (Clean, no thick left border) */}
        {nearestListing && sortBy === 'nearest' && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-emerald-900">
                {t(language, 'nearestFarmer')} · {nearestListing.distanceKm} km from {selectedCity}
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {nearestListing.farmName} ({nearestListing.farmerName}) —{' '}
                {language === 'mr' ? nearestListing.productNameMr : nearestListing.productNameEn} at ₹
                {nearestListing.pricePerKg}/kg
                <span className="font-normal text-slate-600">
                  {' '}
                  (Mandi ₹{nearestListing.mandiModalPrice}/kg · Save {nearestListing.savingsPercent}%)
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectListing(nearestListing)}
              className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 whitespace-nowrap shrink-0"
            >
              {t(language, 'inspectAndOrder')}
            </button>
          </div>
        )}

        {/* Sorted Farmers Produce Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center space-y-3">
            <p className="text-sm text-slate-600">{t(language, 'noResults')}</p>
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                setCategory('All');
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              {language === 'mr' ? 'सर्व फिल्टर काढा' : 'Reset Filters'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((item) => {
              const title = language === 'mr' ? item.productNameMr : item.productNameEn;
              return (
                <article
                  key={item.id}
                  className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                    <img
                      src={resolveProduceImage(item.livePhotoUrl, item.productKey)}
                      alt={title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-5 space-y-4">
                    <div className="space-y-2">
                      {/* Unboxed metadata with typographic separators */}
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="truncate">
                          {item.category} · {item.qualityGrade}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono font-medium text-slate-700 tabular-nums shrink-0">
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                          {item.farmerRatingAvg.toFixed(1)} ({item.farmerRatingCount})
                        </span>
                      </div>

                      <h3 className="text-lg font-semibold text-slate-900">
                        {title} <span className="text-sm font-normal text-slate-500">({item.variety})</span>
                      </h3>

                      <p className="text-xs text-slate-600">
                        <strong className="text-slate-900">{item.farmName}</strong> · {item.farmerArea} ·{' '}
                        <span className="font-mono font-medium text-emerald-900 tabular-nums">
                          {item.distanceKm} km
                        </span>
                      </p>
                    </div>

                    <div className="space-y-3 border-t border-slate-100 pt-3">
                      {/* Market Mandi vs Farmer Price */}
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="font-mono text-xl font-bold text-emerald-900 tabular-nums">
                            ₹{item.pricePerKg}
                          </span>
                          <span className="text-xs text-slate-500">/kg</span>
                          <span className="ml-2 font-mono text-xs text-slate-400 line-through tabular-nums">
                            Mandi ₹{item.mandiModalPrice}/kg
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-800 tabular-nums">
                          <TrendingDown className="h-3.5 w-3.5" />
                          {item.savingsPercent}% off
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                        <span>
                          {t(language, 'minOrder')}: {item.minOrderKg} kg
                        </span>
                        <span>
                          {t(language, 'availableStock')}: {item.availableKg} kg
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Camera className="h-3 w-3 text-emerald-800" />
                          {new Date(item.livePhotoTimestamp).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Truck className="h-3 w-3 text-slate-500" />
                          Cancel {item.cancellationCutoffHours}h prior
                        </span>
                      </div>

                      <div className="grid grid-cols-5 gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectListing(item)}
                          className="col-span-3 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 transition-colors"
                        >
                          {t(language, 'inspectAndOrder')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleSubscribePriceAlert(
                              item.productKey,
                              item.productNameEn,
                              item.productNameMr,
                              Math.max(5, item.pricePerKg - 2)
                            )
                          }
                          className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-2.5 text-xs font-medium text-slate-700 hover:border-emerald-800 hover:text-emerald-900 transition-colors"
                          title={`Notify below ₹${Math.max(5, item.pricePerKg - 2)}/kg`}
                        >
                          <Bell className="h-3.5 w-3.5" />
                          <span>≤₹{Math.max(5, item.pricePerKg - 2)}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
