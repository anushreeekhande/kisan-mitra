import React, { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { ArrowLeft, Plus, Camera, CheckCircle2, Clock } from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  syncListingToFirestore,
  syncUploadedPhotoToFirestore,
  syncUserProfileToFirestore,
  updateOrderStatusInFirestore,
} from '../lib/firebase';
import { t } from '../lib/i18n';
import { resolveProduceImage } from '../lib/images';
import { LiveCameraCapture } from './LiveCameraCapture';
import type { Language, Order, PhotoVerification, ProduceListing, User } from '../types';

interface FarmerDashboardProps {
  language: Language;
  user: User | null;
  fbUser?: FirebaseUser | null;
  onUserUpdated: (u: User) => void;
  onBackHome: () => void;
  onOpenAuth: () => void;
}

const PRODUCT_CATALOG = [
  { key: 'tomato', en: 'Vine Tomatoes', mr: 'टोमॅटो', cat: 'Vegetables' },
  { key: 'onion', en: 'Nashik Red Onions', mr: 'लाल कांदा', cat: 'Vegetables' },
  { key: 'potato', en: 'Talegaon Potatoes', mr: 'बटाटा', cat: 'Vegetables' },
  { key: 'pomegranate', en: 'Bhagwa Pomegranates', mr: 'भगवा डाळिंब', cat: 'Fruits' },
  { key: 'mango', en: 'Alphonso Mangoes', mr: 'हापूस आंबा', cat: 'Fruits' },
  { key: 'okra', en: 'Tender Green Okra', mr: 'भेंडी', cat: 'Vegetables' },
  { key: 'spinach', en: 'Fresh Palak Spinach', mr: 'ताजा पालक', cat: 'Leafy Greens' },
  { key: 'green_chilli', en: 'G4 Green Chillies', mr: 'हिरवी मिरची', cat: 'Vegetables' },
];

export const FarmerDashboard: React.FC<FarmerDashboardProps> = ({
  language,
  user,
  fbUser,
  onUserUpdated,
  onBackHome,
  onOpenAuth,
}) => {
  const [listings, setListings] = useState<ProduceListing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [photoRequests, setPhotoRequests] = useState<PhotoVerification[]>([]);
  const [activeTab, setActiveTab] = useState<'requests' | 'inventory' | 'orders'>('requests');
  const [feedback, setFeedback] = useState<string | null>(null);

  // New listing form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newKey, setNewKey] = useState('tomato');
  const [newNameEn, setNewNameEn] = useState('Vine Tomatoes');
  const [newNameMr, setNewNameMr] = useState('टोमॅटो');
  const [newCategory, setNewCategory] = useState<'Vegetables' | 'Fruits' | 'Leafy Greens'>('Vegetables');
  const [newVariety, setNewVariety] = useState('Vaishali Hybrid');
  const [newPrice, setNewPrice] = useState(23);
  const [newMinKg, setNewMinKg] = useState(40);
  const [newAvailKg, setNewAvailKg] = useState(800);
  const [newCutoff, setNewCutoff] = useState(2);
  const [newGrade, setNewGrade] = useState('Grade A+ Export');
  const [newDesc, setNewDesc] = useState('Morning-picked bulk harvest crates.');
  const [newLivePhoto, setNewLivePhoto] = useState<string>('');

  // Editable inline product name / price / stock / cutoff drafts
  const [editDrafts, setEditDrafts] = useState<
    Record<
      string,
      {
        productNameEn: string;
        productNameMr: string;
        pricePerKg: number;
        availableKg: number;
        cancellationCutoffHours: number;
      }
    >
  >({});
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<Record<string, string>>({});
  const [orderCutoffs, setOrderCutoffs] = useState<Record<string, number>>({});

  const loadFarmerData = async () => {
    if (!user || user.role !== 'farmer') return;
    try {
      const [lRes, oRes, pRes] = await Promise.all([
        apiFetch<{ listings: ProduceListing[] }>('/api/farmer/listings'),
        apiFetch<{ orders: Order[] }>('/api/orders'),
        apiFetch<{ requests: PhotoVerification[] }>('/api/farmer/photo-verifications'),
      ]);
      setListings(lRes.listings);
      setOrders(oRes.orders);
      setPhotoRequests(pRes.requests);

      const drafts: typeof editDrafts = {};
      lRes.listings.forEach((l) => {
        drafts[l.id] = {
          productNameEn: l.productNameEn,
          productNameMr: l.productNameMr,
          pricePerKg: l.pricePerKg,
          availableKg: l.availableKg,
          cancellationCutoffHours: l.cancellationCutoffHours,
        };
      });
      setEditDrafts(drafts);
    } catch {
      // handled cleanly
    }
  };

  useEffect(() => {
    loadFarmerData();
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

  const handleSelectCatalogPreset = (key: string) => {
    setNewKey(key);
    if (key === 'custom') {
      setNewNameEn('');
      setNewNameMr('');
      return;
    }
    const prod = PRODUCT_CATALOG.find((p) => p.key === key);
    if (prod) {
      setNewNameEn(prod.en);
      setNewNameMr(prod.mr);
      setNewCategory(prod.cat as 'Vegetables' | 'Fruits' | 'Leafy Greens');
    }
  };

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEn = newNameEn.trim();
    if (!cleanEn) {
      setFeedback('Please enter a product name.');
      return;
    }
    const resolvedKey =
      newKey === 'custom'
        ? cleanEn.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        : newKey;
    try {
      const res = await apiFetch<{ listing: ProduceListing }>('/api/farmer/listings', {
        method: 'POST',
        body: JSON.stringify({
          productKey: resolvedKey,
          productNameEn: cleanEn,
          productNameMr: newNameMr.trim() || cleanEn,
          category: newCategory,
          variety: newVariety,
          pricePerKg: newPrice,
          minOrderKg: newMinKg,
          availableKg: newAvailKg,
          qualityGrade: newGrade,
          livePhotoUrl: newLivePhoto || resolvedKey,
          cancellationCutoffHours: newCutoff,
          description: newDesc,
        }),
      });
      if (fbUser && res.listing && user) {
        await syncListingToFirestore(
          {
            ...res.listing,
            farmerName: user.name,
            farmName: user.farmName || user.name,
          },
          fbUser
        ).catch(() => {});
        if (newLivePhoto && newLivePhoto.length >= 10) {
          await syncUploadedPhotoToFirestore(
            {
              id: `listing_${res.listing.id}`,
              farmerId: user.id,
              listingId: res.listing.id,
              photoType: 'listing_batch',
              photoDataUrl: newLivePhoto,
              note: `${cleanEn} — ₹${newPrice}/kg`,
            },
            fbUser
          ).catch(() => {});
        }
      }
      setShowNewForm(false);
      setNewLivePhoto('');
      setFeedback('New bulk produce batch published with live timestamp.');
      loadFarmerData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to create listing');
    }
  };

  const handleUpdateListing = async (listingId: string, overridePhoto?: string) => {
    const d = editDrafts[listingId];
    if (!d) return;
    try {
      const res = await apiFetch<{ listing: ProduceListing }>(`/api/farmer/listings/${listingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...d,
          ...(overridePhoto ? { livePhotoUrl: overridePhoto } : {}),
        }),
      });
      if (fbUser && res.listing && user) {
        await syncListingToFirestore(
          {
            ...res.listing,
            farmerName: user.name,
            farmName: user.farmName || user.name,
          },
          fbUser
        ).catch(() => {});
        if (overridePhoto && overridePhoto.length >= 10) {
          await syncUploadedPhotoToFirestore(
            {
              id: `batch_${listingId}_${Date.now()}`,
              farmerId: user.id,
              listingId,
              photoType: 'listing_batch',
              photoDataUrl: overridePhoto,
              note: `${d.productNameEn} — ₹${d.pricePerKg}/kg updated live photo`,
            },
            fbUser
          ).catch(() => {});
        }
      }
      setFeedback('Listing price, cancellation cutoff & stock updated.');
      loadFarmerData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleRespondPhotoRequest = async (reqId: string) => {
    const dataUrl = capturedPhotos[reqId];
    if (!dataUrl) {
      setFeedback('Capture or stamp a live photo with timestamp first.');
      return;
    }
    try {
      const res = await apiFetch<{ verification: PhotoVerification }>(
        `/api/farmer/photo-verifications/${reqId}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({
            photoDataUrl: dataUrl,
            farmerNote: 'Fresh live harvest batch photographed right now at farm.',
          }),
        }
      );
      if (fbUser && user) {
        await syncUploadedPhotoToFirestore(
          {
            id: reqId,
            farmerId: user.id,
            customerId: res.verification?.customerId,
            listingId: res.verification?.listingId || reqId,
            photoType: 'preorder_verification',
            photoDataUrl: dataUrl,
            note: 'Fresh live harvest batch photographed right now at farm.',
          },
          fbUser
        ).catch(() => {});
      }
      setRespondingId(null);
      setFeedback('Live timestamped photo sent to customer! They can now place the bulk order.');
      loadFarmerData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not send photo');
    }
  };

  const handleFarmerOrderAction = async (
    orderId: string,
    action: 'accept' | 'update_cutoff',
    cutoff: number
  ) => {
    try {
      await apiFetch(`/api/orders/${orderId}/farmer-action`, {
        method: 'POST',
        body: JSON.stringify({ action, cancellationCutoffHours: cutoff }),
      });
      if (fbUser && action === 'accept') {
        updateOrderStatusInFirestore(orderId, 'accepted_by_farmer', fbUser).catch(() => {});
      }
      setFeedback(
        action === 'accept'
          ? 'Order accepted and queued for Delivery Agents.'
          : 'Cancellation window updated.'
      );
      loadFarmerData();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Action failed');
    }
  };

  if (!user || user.role !== 'farmer') {
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
          <h1 className="text-2xl font-bold text-slate-900">{t(language, 'navFarmer')}</h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {language === 'mr'
              ? 'तुमचा माल विकण्यासाठी, दर ठरवण्यासाठी, वेळेसह लाइव्ह फोटो अपलोड करण्यासाठी आणि उपलब्धता सेट करण्यासाठी Google किंवा SMS OTP ने शेतकरी म्हणून लॉगिन करा.'
              : 'Sign in with Google or SMS OTP as a Farmer to set your bulk prices, toggle availability, upload live timestamped harvest photos, and manage cancellation windows.'}
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

  const pendingPhotoCount = photoRequests.filter((r) => r.status === 'pending').length;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-8 py-8 space-y-6">
      {/* Top Bar */}
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
            <h1 className="text-xl font-bold text-slate-900">
              {user.farmName || user.name}
            </h1>
            <p className="text-xs text-slate-500">
              {user.name} · {user.area}, {user.city} · Rating {user.ratingAvg.toFixed(1)} ★
            </p>
          </div>
        </div>

        {/* Farmer Availability Toggle */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-600">
            {user.isAvailable ? t(language, 'available') : t(language, 'unavailable')}
          </span>
          <button
            type="button"
            onClick={handleToggleAvailability}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              user.isAvailable
                ? 'bg-emerald-800 text-white hover:bg-emerald-900'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {user.isAvailable
              ? language === 'mr'
                ? 'उपलब्ध आहे (बदलण्यासाठी क्लिक करा)'
                : 'Available (Click to Pause)'
              : language === 'mr'
              ? 'अनुपलब्ध (सुरू करण्यासाठी क्लिक करा)'
              : 'Not Available (Click to Go Live)'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </div>
      )}

      {/* Segmented Workspace Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'requests' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {language === 'mr' ? 'थेट फोटो विनंत्या' : 'Live Photo Requests'} ({pendingPhotoCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'inventory' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {language === 'mr' ? 'माझा माल व दर' : 'Bulk Listings & Pricing'} ({listings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'orders' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {language === 'mr' ? 'आलेल्या ऑर्डर्स' : 'Incoming Orders'} ({orders.length})
          </button>
        </div>

        {activeTab === 'inventory' && (
          <button
            type="button"
            onClick={() => setShowNewForm(!showNewForm)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
          >
            <Plus className="h-4 w-4" />
            <span>{language === 'mr' ? 'नवीन माल जोडा' : 'Add Bulk Produce Batch'}</span>
          </button>
        )}
      </div>

      {/* TAB 1: LIVE PHOTO VERIFICATION REQUESTS */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {photoRequests.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
              No buyer live-photo verification requests pending right now.
            </div>
          ) : (
            photoRequests.map((reqItem) => (
              <div
                key={reqItem.id}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Buyer: {reqItem.customerName} · Requested{' '}
                      {new Date(reqItem.requestedAt).toLocaleString('en-IN')}
                    </p>
                    <h3 className="text-base font-semibold text-slate-900">
                      {language === 'mr' ? reqItem.productNameMr : reqItem.productNameEn} — Real-Time Photo Check
                    </h3>
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      reqItem.status === 'sent' ? 'text-emerald-800' : 'text-amber-700'
                    }`}
                  >
                    {reqItem.status === 'sent' ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" /> Sent to Buyer
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-4 w-4" /> Waiting for Live Photo
                      </span>
                    )}
                  </span>
                </div>

                {reqItem.status === 'pending' || respondingId === reqItem.id ? (
                  <div className="space-y-3">
                    <LiveCameraCapture
                      language={language}
                      farmerArea={`${user.area}, ${user.city}`}
                      defaultImageUrl={resolveProduceImage(null, 'tomato')}
                      onCapture={(dataUrl) =>
                        setCapturedPhotos((prev) => ({ ...prev, [reqItem.id]: dataUrl }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => handleRespondPhotoRequest(reqItem.id)}
                      className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                    >
                      Send Real-Time Timestamped Photo to Customer
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={resolveProduceImage(reqItem.photoDataUrl, 'tomato')}
                        alt="Verified harvest"
                        referrerPolicy="no-referrer"
                        className="h-14 w-20 rounded-lg object-cover border border-slate-200"
                      />
                      <span className="font-mono text-xs text-slate-600 tabular-nums">
                        Sent at {reqItem.photoTimestamp ? new Date(reqItem.photoTimestamp).toLocaleString('en-IN') : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRespondingId(reqItem.id)}
                      className="text-xs font-medium text-emerald-800 hover:underline"
                    >
                      Send Newer Photo
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: INVENTORY, PRICING & TIMESTAMPED PHOTOS */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          {showNewForm && (
            <form
              onSubmit={handleCreateListing}
              className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
            >
              <h3 className="text-base font-semibold text-slate-900">
                Publish New Bulk Produce Batch
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Quick Preset or Custom
                  </label>
                  <select
                    value={newKey}
                    onChange={(e) => handleSelectCatalogPreset(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {PRODUCT_CATALOG.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.en} ({p.mr})
                      </option>
                    ))}
                    <option value="custom">Custom Product Name...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t(language, 'productNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={newNameEn}
                    onChange={(e) => setNewNameEn(e.target.value)}
                    placeholder="Type any vegetable or fruit name"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t(language, 'productNameMrLabel')}
                  </label>
                  <input
                    type="text"
                    value={newNameMr}
                    onChange={(e) => setNewNameMr(e.target.value)}
                    placeholder="मराठी नाव (ऐच्छिक)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) =>
                      setNewCategory(e.target.value as 'Vegetables' | 'Fruits' | 'Leafy Greens')
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="Vegetables">Vegetables</option>
                    <option value="Fruits">Fruits</option>
                    <option value="Leafy Greens">Leafy Greens</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Variety</label>
                  <input
                    type="text"
                    required
                    value={newVariety}
                    onChange={(e) => setNewVariety(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Quality Grade</label>
                  <select
                    value={newGrade}
                    onChange={(e) => setNewGrade(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option>Grade A+ Export</option>
                    <option>Grade A Farm Fresh</option>
                    <option>Grade B Standard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Farmer Price (₹/kg)
                  </label>
                  <input
                    type="number"
                    required
                    min={5}
                    value={newPrice}
                    onChange={(e) => setNewPrice(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Min Bulk Order (kg)
                  </label>
                  <input
                    type="number"
                    required
                    min={10}
                    value={newMinKg}
                    onChange={(e) => setNewMinKg(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Available Stock (kg)
                  </label>
                  <input
                    type="number"
                    required
                    min={20}
                    value={newAvailKg}
                    onChange={(e) => setNewAvailKg(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Cancellation Cutoff (hrs before dispatch)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={48}
                    value={newCutoff}
                    onChange={(e) => setNewCutoff(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Description
                  </label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <LiveCameraCapture
                language={language}
                farmerArea={`${user.area}, ${user.city}`}
                defaultImageUrl={resolveProduceImage(null, newKey)}
                onCapture={(dataUrl) => setNewLivePhoto(dataUrl)}
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-800 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                >
                  Publish Batch
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {listings.map((item) => {
              const draft = editDrafts[item.id] || {
                productNameEn: item.productNameEn,
                productNameMr: item.productNameMr,
                pricePerKg: item.pricePerKg,
                availableKg: item.availableKg,
                cancellationCutoffHours: item.cancellationCutoffHours,
              };
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
                >
                  <div className="flex items-start gap-4">
                    <img
                      src={resolveProduceImage(item.livePhotoUrl, item.productKey)}
                      alt={item.productNameEn}
                      referrerPolicy="no-referrer"
                      className="h-20 w-24 rounded-lg object-cover border border-slate-200"
                    />
                    <div className="flex-1">
                      <h3 className="text-base font-bold text-slate-900">
                        {language === 'mr' ? draft.productNameMr : draft.productNameEn} ({item.variety})
                      </h3>
                      <p className="text-xs text-slate-500">
                        {item.qualityGrade} · Min {item.minOrderKg} kg
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
                        <Camera className="inline h-3.5 w-3.5 mr-1 text-emerald-800" />
                        Photo stamped {new Date(item.livePhotoTimestamp).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>

                  {/* Editable Product Name (English & Marathi) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t(language, 'productNameLabel')}
                      </label>
                      <input
                        type="text"
                        value={draft.productNameEn}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, productNameEn: e.target.value },
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        {t(language, 'productNameMrLabel')}
                      </label>
                      <input
                        type="text"
                        value={draft.productNameMr}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, productNameMr: e.target.value },
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Your Price (₹/kg)
                      </label>
                      <input
                        type="number"
                        value={draft.pricePerKg}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, pricePerKg: Number(e.target.value) },
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Stock (kg)
                      </label>
                      <input
                        type="number"
                        value={draft.availableKg}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, availableKg: Number(e.target.value) },
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Cancel Cutoff (h)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={draft.cancellationCutoffHours}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...draft,
                              cancellationCutoffHours: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <LiveCameraCapture
                    language={language}
                    farmerArea={`${user.area}, ${user.city}`}
                    defaultImageUrl={resolveProduceImage(item.livePhotoUrl, item.productKey)}
                    buttonLabel="Update Live Batch Photo + Timestamp"
                    onCapture={(dataUrl) => handleUpdateListing(item.id, dataUrl)}
                  />

                  <button
                    type="button"
                    onClick={() => handleUpdateListing(item.id)}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                  >
                    Save Name, Price, Stock & Cancellation Cutoff
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: INCOMING ORDERS */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {orders.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
              No bulk orders received yet.
            </div>
          ) : (
            orders.map((order) => {
              const cutoffVal = orderCutoffs[order.id] ?? order.cancellationCutoffHours;
              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs text-slate-500">
                        {order.orderCode} · Status: {order.status.replace(/_/g, ' ')}
                      </p>
                      <h3 className="text-base font-bold text-slate-900">
                        {order.productNameEn} — {order.quantityKg} kg (₹
                        {order.totalAmount.toLocaleString('en-IN')})
                      </h3>
                      <p className="text-xs text-slate-600">
                        Buyer: {order.customerName} ({order.customerPhone}) · {order.deliveryAddress}
                      </p>
                      <p className="text-xs text-slate-500">
                        Scheduled: {new Date(order.scheduledDeliveryAt).toLocaleString('en-IN')}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-600">Cancel Cutoff (hrs):</span>
                        <input
                          type="number"
                          min={1}
                          max={48}
                          value={cutoffVal}
                          onChange={(e) =>
                            setOrderCutoffs((prev) => ({
                              ...prev,
                              [order.id]: Number(e.target.value),
                            }))
                          }
                          className="w-16 rounded-lg border border-slate-300 px-2 py-1 font-mono text-xs tabular-nums"
                        />
                      </div>

                      {order.status === 'placed' ? (
                        <button
                          type="button"
                          onClick={() => handleFarmerOrderAction(order.id, 'accept', cutoffVal)}
                          className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
                        >
                          Accept Bulk Order & Dispatch to Agents
                        </button>
                      ) : order.status !== 'cancelled' && order.status !== 'delivered' ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleFarmerOrderAction(order.id, 'update_cutoff', cutoffVal)
                          }
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Update Cancel Window
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
};
