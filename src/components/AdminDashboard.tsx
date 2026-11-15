import React, { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  ArrowLeft,
  ShieldCheck,
  Lock,
  LogOut,
  Users,
  PackageCheck,
  Plus,
  RefreshCw,
  Cloud,
  CheckCircle2,
} from 'lucide-react';
import { adminApiFetch, getAdminToken, setAdminToken } from '../lib/api';
import {
  ADMIN_EMAIL,
  FIREBASE_PROJECT_ID,
  fetchAllFirestoreForAdmin,
  signInWithGoogleFirebase,
  syncListingToFirestore,
  syncOrderToFirestore,
  syncUserProfileToFirestore,
  updateOrderStatusInFirestore,
  payOrderInFirestore,
  type FirestoreAdminVault,
} from '../lib/firebase';
import { t } from '../lib/i18n';
import type { CityHub, Language, Order, OrderStatus, ProduceListing, User, UserRole } from '../types';

interface AdminDashboardProps {
  language: Language;
  cities: CityHub[];
  fbUser?: FirebaseUser | null;
  onBackHome: () => void;
}

interface AdminStats {
  totalUsers: number;
  customersCount: number;
  farmersCount: number;
  deliveryCount: number;
  totalOrders: number;
  activeOrders: number;
  deliveredOrders: number;
  totalRevenue: number;
}

type AdminTab = 'registrations' | 'orders' | 'create_registration' | 'create_order' | 'firebase';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  language,
  cities,
  fbUser,
  onBackHome,
}) => {
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Admin Login Form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Admin Data
  const [tab, setTab] = useState<AdminTab>('registrations');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [listings, setListings] = useState<ProduceListing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [userSearch, setUserSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all');
  const [orderSearch, setOrderSearch] = useState('');

  // Create Registration Form
  const [regRole, setRegRole] = useState<UserRole>('customer');
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regCity, setRegCity] = useState('Pune');
  const [regArea, setRegArea] = useState('');
  const [regFarmName, setRegFarmName] = useState('');
  const [regVehicle, setRegVehicle] = useState('');
  const [regBusy, setRegBusy] = useState(false);

  // Create Order Form
  const [ordCustomerId, setOrdCustomerId] = useState('');
  const [ordListingId, setOrdListingId] = useState('');
  const [ordQtyKg, setOrdQtyKg] = useState(50);
  const [ordPaymentMethod, setOrdPaymentMethod] = useState<'UPI' | 'Bank Transfer' | 'Bulk COD'>('UPI');
  const [ordAddress, setOrdAddress] = useState('');
  const [ordCity, setOrdCity] = useState('Pune');
  const [ordAgentId, setOrdAgentId] = useState('');
  const [ordBusy, setOrdBusy] = useState(false);

  // Firestore Admin Archive
  const [fbVault, setFbVault] = useState<FirestoreAdminVault | null>(null);
  const [fbBusy, setFbBusy] = useState(false);

  const loadOverview = async () => {
    setLoadingData(true);
    try {
      const res = await adminApiFetch<{
        stats: AdminStats;
        users: User[];
        listings: ProduceListing[];
        orders: Order[];
      }>('/api/admin/overview');
      setStats(res.stats);
      setUsers(res.users);
      setListings(res.listings);
      setOrders(res.orders);

      const firstCust = res.users.find((u) => u.role === 'customer');
      if (firstCust && !ordCustomerId) {
        setOrdCustomerId(firstCust.id);
        setOrdCity(firstCust.city);
        setOrdAddress(`${firstCust.area}, ${firstCust.city}`);
      }
      const firstList = res.listings[0];
      if (firstList && !ordListingId) {
        setOrdListingId(firstList.id);
        setOrdQtyKg(firstList.minOrderKg);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not load admin overview');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!getAdminToken()) {
      setCheckingAuth(false);
      return;
    }
    adminApiFetch<{ admin: { email: string } }>('/api/admin/me')
      .then((res) => {
        setAdminEmail(res.admin.email);
        loadOverview();
      })
      .catch(() => {
        setAdminToken(null);
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      const res = await adminApiFetch<{ token: string; admin: { email: string } }>(
        '/api/admin/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
        }
      );
      setAdminToken(res.token);
      setAdminEmail(res.admin.email);
      setLoginPassword('');
      await loadOverview();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Admin login failed');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleAdminGoogleLogin = async (forceAccountSelect = false) => {
    setLoginError(null);
    setLoginBusy(true);
    try {
      const activeFbUser =
        !forceAccountSelect && fbUser ? fbUser : await signInWithGoogleFirebase(forceAccountSelect);
      const idToken = await activeFbUser.getIdToken();
      const res = await adminApiFetch<{ token: string; admin: { email: string } }>(
        '/api/admin/firebase-login',
        {
          method: 'POST',
          body: JSON.stringify({ idToken }),
        }
      );
      setAdminToken(res.token);
      setAdminEmail(res.admin.email);
      await loadOverview();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Google Admin sign-in failed');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleAdminLogout = async () => {
    await adminApiFetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setAdminToken(null);
    setAdminEmail(null);
    setUsers([]);
    setOrders([]);
    setStats(null);
    setFbVault(null);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setRegBusy(true);
    try {
      const res = await adminApiFetch<{ user: User }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          role: regRole,
          name: regName,
          phone: regPhone,
          city: regCity,
          area: regArea,
          farmName: regFarmName,
          vehicleType: regVehicle,
          language,
        }),
      });
      if (fbUser && fbUser.email?.toLowerCase() === ADMIN_EMAIL) {
        await syncUserProfileToFirestore(res.user, fbUser).catch(() => {});
      }
      setRegName('');
      setRegPhone('');
      setRegArea('');
      setRegFarmName('');
      setRegVehicle('');
      setFeedback(`Registered ${res.user.role} "${res.user.name}" (+91 ${res.user.phone}).`);
      setTab('registrations');
      loadOverview();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegBusy(false);
    }
  };

  const handleToggleUserAvailability = async (u: User) => {
    try {
      const res = await adminApiFetch<{ user: User }>(`/api/admin/users/${u.id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: !u.isAvailable }),
      });
      if (fbUser && fbUser.email?.toLowerCase() === ADMIN_EMAIL) {
        await syncUserProfileToFirestore(res.user, fbUser).catch(() => {});
      }
      loadOverview();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to update availability');
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setOrdBusy(true);
    try {
      const res = await adminApiFetch<{ order: Order }>('/api/admin/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: ordCustomerId,
          listingId: ordListingId,
          quantityKg: ordQtyKg,
          paymentMethod: ordPaymentMethod,
          deliveryAddress: ordAddress,
          deliveryCity: ordCity,
          deliveryAgentId: ordAgentId || undefined,
          status: ordAgentId ? 'out_for_delivery' : 'accepted_by_farmer',
        }),
      });
      if (fbUser && fbUser.email?.toLowerCase() === ADMIN_EMAIL && res.order) {
        await syncOrderToFirestore(res.order, fbUser).catch(() => {});
      }
      setFeedback(`Order ${res.order.orderCode} created (${res.order.quantityKg} kg).`);
      setTab('orders');
      loadOverview();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Order creation failed');
    } finally {
      setOrdBusy(false);
    }
  };

  const handleUpdateOrder = async (
    orderId: string,
    updates: { status?: OrderStatus; paymentStatus?: 'Pending' | 'Paid'; deliveryAgentId?: string | null }
  ) => {
    setFeedback(null);
    try {
      await adminApiFetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      if (fbUser && fbUser.email?.toLowerCase() === ADMIN_EMAIL) {
        if (updates.status) {
          await updateOrderStatusInFirestore(orderId, updates.status, fbUser).catch(() => {});
        }
        if (updates.paymentStatus === 'Paid') {
          await payOrderInFirestore(orderId, fbUser).catch(() => {});
        }
      }
      setFeedback('Order updated.');
      loadOverview();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleConnectAndSyncAllToFirestore = async () => {
    setFeedback(null);
    setFbBusy(true);
    try {
      const activeFbUser = fbUser || (await signInWithGoogleFirebase());
      if (activeFbUser.email?.toLowerCase() !== ADMIN_EMAIL) {
        setFeedback(`Signed in as ${activeFbUser.email}. Sign in with ${ADMIN_EMAIL} for full Firestore Admin access.`);
        setFbBusy(false);
        return;
      }

      for (const u of users) {
        await syncUserProfileToFirestore(u, activeFbUser).catch(() => {});
      }
      for (const l of listings) {
        await syncListingToFirestore(l, activeFbUser).catch(() => {});
      }
      for (const o of orders) {
        await syncOrderToFirestore(o, activeFbUser).catch(() => {});
      }

      const vaultData = await fetchAllFirestoreForAdmin(activeFbUser);
      setFbVault(vaultData);
      setFeedback(
        `Synced ${users.length} registrations, ${listings.length} listings, and ${orders.length} orders to Firestore (${FIREBASE_PROJECT_ID}).`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Firestore admin sync failed');
    } finally {
      setFbBusy(false);
    }
  };

  if (checkingAuth) {
    return (
      <section className="mx-auto max-w-4xl px-4 sm:px-6 py-12">
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </section>
    );
  }

  // STRICT ADMIN-ONLY LOGIN GATE
  if (!adminEmail) {
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

        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">
              {language === 'mr' ? 'प्रशासन पोर्टल लॉगिन' : 'Kisan Mitra Admin Portal'}
            </h1>
            <p className="text-xs text-slate-600">
              {language === 'mr'
                ? 'फक्त अधिकृत प्रशासकासाठी प्रवेश. सर्व नोंदणी आणि ऑर्डर्स पाहण्यासाठी लॉगिन करा.'
                : 'Restricted to authorized administrator credentials only. Manage all registrations and orders.'}
            </p>
          </div>

          {loginError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {loginError}
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Admin Email</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Admin Password</label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter admin password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loginBusy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{loginBusy ? '...' : 'Sign In as Admin'}</span>
            </button>
          </form>

          <div className="relative flex items-center">
            <div className="grow border-t border-slate-200" />
            <span className="mx-3 shrink-0 text-[11px] font-medium text-slate-400 uppercase">or</span>
            <div className="grow border-t border-slate-200" />
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={loginBusy}
              onClick={() => handleAdminGoogleLogin(false)}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:border-emerald-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span className="truncate">
                {fbUser?.email
                  ? `Sign in with Google (${fbUser.email})`
                  : 'Sign in with Google (Admin)'}
              </span>
            </button>
            {fbUser?.email && (
              <button
                type="button"
                disabled={loginBusy}
                onClick={() => handleAdminGoogleLogin(true)}
                className="w-full text-center text-[11px] font-medium text-emerald-800 hover:underline disabled:opacity-50"
              >
                Switch Google account
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  const customers = users.filter((u) => u.role === 'customer');
  const deliveryAgents = users.filter((u) => u.role === 'delivery');

  const filteredUsers = users.filter((u) => {
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const q = userSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.phone.includes(q) ||
      u.city.toLowerCase().includes(q) ||
      u.area.toLowerCase().includes(q) ||
      (u.farmName || '').toLowerCase().includes(q);
    return matchRole && matchQuery;
  });

  const filteredOrders = orders.filter((o) => {
    const matchStatus = orderStatusFilter === 'all' || o.status === orderStatusFilter;
    const q = orderSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      o.orderCode.toLowerCase().includes(q) ||
      o.productNameEn.toLowerCase().includes(q) ||
      (o.customerName || '').toLowerCase().includes(q) ||
      (o.farmerName || '').toLowerCase().includes(q) ||
      o.deliveryCity.toLowerCase().includes(q);
    return matchStatus && matchQuery;
  });

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-8 py-8 space-y-6">
      {/* Top Admin Header */}
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
            <h1 className="text-xl font-bold text-slate-900">Admin Control Console</h1>
            <p className="text-xs text-slate-500">
              Authenticated as <span className="font-mono text-slate-800">{adminEmail}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadOverview}
            disabled={loadingData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleAdminLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Admin Sign Out</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total Registrations</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.totalUsers}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Customers</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.customersCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Farmers</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.farmersCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Delivery Agents</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.deliveryCount}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total Orders</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {stats.totalOrders}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Bulk Order Volume</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-900 tabular-nums">
              ₹{stats.totalRevenue.toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      )}

      {feedback && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Workspace Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('registrations')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'registrations' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>All Registrations ({users.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('orders')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'orders' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <PackageCheck className="h-3.5 w-3.5" />
          <span>All Orders ({orders.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('create_registration')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'create_registration' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Register User (Admin)</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('create_order')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'create_order' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Create Order (Admin)</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('firebase')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'firebase' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Cloud className="h-3.5 w-3.5" />
          <span>Firebase Admin Sync</span>
        </button>
      </div>

      {/* TAB 1: ALL REGISTRATIONS */}
      {tab === 'registrations' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['all', 'customer', 'farmer', 'delivery'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                    roleFilter === r ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search name, mobile, city, farm..."
              className="w-full sm:w-72 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-700 focus:outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name & Entity</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Mobile</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Registered</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{u.name}</p>
                      {(u.farmName || u.vehicleType) && (
                        <p className="text-slate-500">{u.farmName || u.vehicleType}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize font-medium text-emerald-900">{u.role}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-700">+91 {u.phone}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {u.area}, {u.city}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-medium ${
                          u.isAvailable ? 'text-emerald-800' : 'text-slate-500'
                        }`}
                      >
                        {u.isAvailable ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleUserAvailability(u)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {u.isAvailable ? 'Pause' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No matching registrations found.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ALL ORDERS */}
      {tab === 'orders' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <select
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value as 'all' | OrderStatus)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800"
            >
              <option value="all">All Statuses</option>
              <option value="placed">Placed</option>
              <option value="accepted_by_farmer">Accepted by Farmer</option>
              <option value="out_for_delivery">Out for Delivery</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <input
              type="search"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Search order code, produce, customer, farmer..."
              className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-emerald-700 focus:outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Produce & Qty</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Farmer</th>
                  <th className="px-4 py-3 font-semibold">Amount & Pay</th>
                  <th className="px-4 py-3 font-semibold">Delivery Agent</th>
                  <th className="px-4 py-3 font-semibold">Status Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3 font-mono tabular-nums">
                      <p className="font-semibold text-slate-900">{o.orderCode}</p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(o.createdAt).toLocaleDateString('en-IN')}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{o.productNameEn}</p>
                      <p className="font-mono tabular-nums text-slate-600">
                        {o.quantityKg} kg · ₹{o.pricePerKg}/kg
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{o.customerName}</p>
                      <p className="text-slate-500">{o.deliveryCity}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{o.farmName || o.farmerName}</p>
                      <p className="text-slate-500">{o.farmerPhone}</p>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      <p className="font-bold text-slate-900">
                        ₹{o.totalAmount.toLocaleString('en-IN')}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        {o.paymentStatus} · {o.paymentMethod}
                      </p>
                      {o.paymentStatus === 'Pending' && o.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateOrder(o.id, { paymentStatus: 'Paid' })}
                          className="mt-1 text-[11px] font-sans font-semibold text-emerald-800 hover:underline"
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={o.deliveryAgentId || ''}
                        onChange={(e) =>
                          handleUpdateOrder(o.id, { deliveryAgentId: e.target.value || null })
                        }
                        disabled={o.status === 'delivered' || o.status === 'cancelled'}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      >
                        <option value="">Unassigned</option>
                        {deliveryAgents.map((da) => (
                          <option key={da.id} value={da.id}>
                            {da.name} ({da.city})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={o.status}
                        onChange={(e) =>
                          handleUpdateOrder(o.id, { status: e.target.value as OrderStatus })
                        }
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium"
                      >
                        <option value="placed">Placed</option>
                        <option value="accepted_by_farmer">Accepted by Farmer</option>
                        <option value="awaiting_delivery">Awaiting Delivery</option>
                        <option value="out_for_delivery">Out for Delivery</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredOrders.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No matching orders found.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: REGISTER USER FROM ADMIN END */}
      {tab === 'create_registration' && (
        <form
          onSubmit={handleCreateUser}
          className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 space-y-5"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Create Registration from Admin Desk
            </h2>
            <p className="text-xs text-slate-500">
              Onboard a verified Customer, Farmer, or Delivery Agent directly into the database.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Role</label>
            <div className="grid grid-cols-3 gap-2">
              {(['customer', 'farmer', 'delivery'] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegRole(r)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${
                    regRole === r
                      ? 'border-emerald-800 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="e.g. Rajeshwar Patil"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                10-Digit Mobile Number
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="9823011122"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">City Hub</label>
              <select
                value={regCity}
                onChange={(e) => setRegCity(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {cities.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Area / Village</label>
              <input
                type="text"
                required
                value={regArea}
                onChange={(e) => setRegArea(e.target.value)}
                placeholder="e.g. Baramati / Kothrud"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {regRole === 'farmer' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Farm / FPO Name
                </label>
                <input
                  type="text"
                  required
                  value={regFarmName}
                  onChange={(e) => setRegFarmName(e.target.value)}
                  placeholder="e.g. Sahyadri Agro FPO"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            {regRole === 'delivery' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Vehicle Type & Capacity
                </label>
                <input
                  type="text"
                  required
                  value={regVehicle}
                  onChange={(e) => setRegVehicle(e.target.value)}
                  placeholder="e.g. Mahindra Bolero Pik-Up (1.7 Ton)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={regBusy}
            className="rounded-lg bg-emerald-800 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            {regBusy ? 'Registering...' : `Create ${regRole} Registration`}
          </button>
        </form>
      )}

      {/* TAB 4: CREATE ORDER FROM ADMIN END */}
      {tab === 'create_order' && (
        <form
          onSubmit={handleCreateOrder}
          className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 space-y-5"
        >
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Create Bulk Order from Admin Desk
            </h2>
            <p className="text-xs text-slate-500">
              Place and dispatch a bulk produce order directly on behalf of a registered customer.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Customer</label>
              <select
                required
                value={ordCustomerId}
                onChange={(e) => {
                  setOrdCustomerId(e.target.value);
                  const found = customers.find((c) => c.id === e.target.value);
                  if (found) {
                    setOrdCity(found.city);
                    setOrdAddress(`${found.area}, ${found.city}`);
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.city})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Farmer Produce Batch
              </label>
              <select
                required
                value={ordListingId}
                onChange={(e) => {
                  setOrdListingId(e.target.value);
                  const found = listings.find((l) => l.id === e.target.value);
                  if (found) setOrdQtyKg(found.minOrderKg);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.productNameEn} — {l.farmerName} (₹{l.pricePerKg}/kg · {l.availableKg}kg left)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Quantity (kg)
              </label>
              <input
                type="number"
                required
                min={10}
                value={ordQtyKg}
                onChange={(e) => setOrdQtyKg(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Method
              </label>
              <select
                value={ordPaymentMethod}
                onChange={(e) =>
                  setOrdPaymentMethod(e.target.value as 'UPI' | 'Bank Transfer' | 'Bulk COD')
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Bulk COD">Bulk COD</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Delivery City
              </label>
              <select
                value={ordCity}
                onChange={(e) => setOrdCity(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {cities.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Assign Delivery Agent (Optional)
              </label>
              <select
                value={ordAgentId}
                onChange={(e) => setOrdAgentId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Open for Agents</option>
                {deliveryAgents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.city})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Delivery Address
              </label>
              <input
                type="text"
                required
                value={ordAddress}
                onChange={(e) => setOrdAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={ordBusy}
            className="rounded-lg bg-emerald-800 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            {ordBusy ? 'Creating Order...' : 'Create & Dispatch Bulk Order'}
          </button>
        </form>
      )}

      {/* TAB 5: FIREBASE ADMIN CLOUD RECORDS */}
      {tab === 'firebase' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cloud Firestore Admin Records ({FIREBASE_PROJECT_ID})
              </h2>
              <p className="text-xs text-slate-500">
                Verify with Google account <span className="font-mono">{ADMIN_EMAIL}</span> to
                sync all registrations & orders and inspect every Firestore collection.
              </p>
            </div>
            <button
              type="button"
              onClick={handleConnectAndSyncAllToFirestore}
              disabled={fbBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
            >
              <Cloud className="h-4 w-4" />
              <span>
                {fbBusy ? 'Syncing...' : 'Sync All Registrations & Orders to Firestore'}
              </span>
            </button>
          </div>

          {fbVault && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs border-t border-slate-100 pt-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Public Profiles</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {fbVault.profiles.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Private PII Docs</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {fbVault.privateProfiles.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Sign-In Events</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {fbVault.signIns.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Produce Listings</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {fbVault.listings.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Uploaded Photos</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                  {fbVault.uploadedPhotos.length}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-500">Orders Stored</p>
                <p className="mt-1 font-mono text-xl font-bold text-emerald-900 tabular-nums">
                  {fbVault.orders.length}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
