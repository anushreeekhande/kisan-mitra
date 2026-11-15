import { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { apiFetch, getAuthToken, setAuthToken } from './lib/api';
import {
  subscribeFirebaseAuth,
  signOutFirebase,
  syncUserProfileToFirestore,
} from './lib/firebase';
import { t } from './lib/i18n';
import { AuthModal } from './components/AuthModal';
import { AiBotDrawer } from './components/AiBotDrawer';
import { MarketplaceView } from './components/MarketplaceView';
import { OrdersTrackingView } from './components/OrdersTrackingView';
import { FarmerDashboard } from './components/FarmerDashboard';
import { DeliveryDashboard } from './components/DeliveryDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import type { CityHub, Language, ProduceListing, User, UserRole } from './types';

type ActiveView = 'marketplace' | 'orders' | 'farmer' | 'delivery' | 'admin';

export default function App() {
  const [view, setView] = useState<ActiveView>('marketplace');
  const [language, setLanguage] = useState<Language>('en');
  const [user, setUser] = useState<User | null>(null);
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [cities, setCities] = useState<CityHub[]>([]);
  const [selectedCity, setSelectedCity] = useState('Pune');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedListing, setSelectedListing] = useState<ProduceListing | null>(null);

  const [authOpen, setAuthOpen] = useState(false);
  const [authRoleHint, setAuthRoleHint] = useState<UserRole>('customer');

  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeFirebaseAuth((nextFbUser) => {
      setFbUser(nextFbUser);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (user && fbUser) {
      syncUserProfileToFirestore(user, fbUser).catch(() => {});
    }
  }, [user, fbUser]);

  useEffect(() => {
    apiFetch<{ cities: CityHub[] }>('/api/cities')
      .then((res) => setCities(res.cities))
      .catch(() => {});

    if (getAuthToken()) {
      apiFetch<{ user: User }>('/api/auth/me')
        .then((res) => {
          setUser(res.user);
          setLanguage(res.user.language || 'en');
          setSelectedCity(res.user.city || 'Pune');
        })
        .catch(() => {
          setAuthToken(null);
        });
    }
  }, []);

  const handleLanguageChange = async (lang: Language) => {
    setLanguage(lang);
    if (user) {
      apiFetch<{ user: User }>('/api/users/language', {
        method: 'PATCH',
        body: JSON.stringify({ language: lang }),
      })
        .then((res) => setUser(res.user))
        .catch(() => {});
    }
  };

  const handleGoHome = () => {
    setSelectedListing(null);
    setView('marketplace');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSignOut = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await signOutFirebase().catch(() => {});
    setAuthToken(null);
    setUser(null);
    setView('marketplace');
  };

  const handleAuthenticated = (authedUser: User) => {
    setUser(authedUser);
    setSelectedCity(authedUser.city || 'Pune');
    if (authedUser.role === 'farmer') {
      setView('farmer');
    } else if (authedUser.role === 'delivery') {
      setView('delivery');
    } else if (view === 'farmer' || view === 'delivery') {
      setView('marketplace');
    }
  };

  const openAuthForRole = (role: UserRole) => {
    setAuthRoleHint(role);
    setAuthOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-8 py-4">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={handleGoHome}
            className="text-xl font-bold tracking-tight text-emerald-950 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded-md"
          >
            {t(language, 'brand')}
          </button>

          {/* Zone 2: 4 Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={handleGoHome}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                view === 'marketplace' ? 'text-emerald-900 font-semibold underline underline-offset-8' : ''
              }`}
            >
              {t(language, 'navMarketplace')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedListing(null);
                setView('orders');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                view === 'orders' ? 'text-emerald-900 font-semibold underline underline-offset-8' : ''
              }`}
            >
              {t(language, 'navOrders')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedListing(null);
                setView('farmer');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                view === 'farmer' ? 'text-emerald-900 font-semibold underline underline-offset-8' : ''
              }`}
            >
              {t(language, 'navFarmer')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedListing(null);
                setView('delivery');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                view === 'delivery' ? 'text-emerald-900 font-semibold underline underline-offset-8' : ''
              }`}
            >
              {t(language, 'navDelivery')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedListing(null);
                setView('admin');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-950 ${
                view === 'admin' ? 'text-emerald-900 font-semibold underline underline-offset-8' : ''
              }`}
            >
              {t(language, 'navAdmin')}
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                {user.name} · {t(language, 'signOut')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuthForRole('customer')}
                className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 whitespace-nowrap shrink-0"
              >
                {t(language, 'signInRegister')}
              </button>
            )}
          </div>
        </div>

        {/* Mobile secondary navigation bar */}
        <div className="flex md:hidden items-center justify-around border-t border-slate-100 px-2 py-2 text-xs font-medium text-slate-600">
          <button
            type="button"
            onClick={handleGoHome}
            className={`px-2 py-1 whitespace-nowrap ${view === 'marketplace' ? 'text-emerald-900 font-semibold' : ''}`}
          >
            {t(language, 'navMarketplace')}
          </button>
          <button
            type="button"
            onClick={() => setView('orders')}
            className={`px-2 py-1 whitespace-nowrap ${view === 'orders' ? 'text-emerald-900 font-semibold' : ''}`}
          >
            {t(language, 'navOrders')}
          </button>
          <button
            type="button"
            onClick={() => setView('farmer')}
            className={`px-2 py-1 whitespace-nowrap ${view === 'farmer' ? 'text-emerald-900 font-semibold' : ''}`}
          >
            {t(language, 'navFarmer')}
          </button>
          <button
            type="button"
            onClick={() => setView('delivery')}
            className={`px-2 py-1 whitespace-nowrap ${view === 'delivery' ? 'text-emerald-900 font-semibold' : ''}`}
          >
            {t(language, 'navDelivery')}
          </button>
          <button
            type="button"
            onClick={() => setView('admin')}
            className={`px-2 py-1 whitespace-nowrap ${view === 'admin' ? 'text-emerald-900 font-semibold' : ''}`}
          >
            {t(language, 'navAdmin')}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {view === 'marketplace' && (
          <MarketplaceView
            language={language}
            onLanguageChange={handleLanguageChange}
            user={user}
            fbUser={fbUser}
            cities={cities}
            selectedCity={selectedCity}
            onCityChange={setSelectedCity}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedListing={selectedListing}
            onSelectListing={setSelectedListing}
            onOpenAuth={() => openAuthForRole('customer')}
            onOpenAiWithPrompt={(prompt) => {
              setAiPrefill(prompt);
              setAiOpen(true);
            }}
            onOrderCreated={() => {
              setSelectedListing(null);
              setView('orders');
            }}
          />
        )}

        {view === 'orders' && (
          <OrdersTrackingView
            language={language}
            user={user}
            fbUser={fbUser}
            onBackHome={handleGoHome}
            onOpenAuth={() => openAuthForRole('customer')}
          />
        )}

        {view === 'farmer' && (
          <FarmerDashboard
            language={language}
            user={user}
            fbUser={fbUser}
            onUserUpdated={setUser}
            onBackHome={handleGoHome}
            onOpenAuth={() => openAuthForRole('farmer')}
          />
        )}

        {view === 'delivery' && (
          <DeliveryDashboard
            language={language}
            user={user}
            fbUser={fbUser}
            onUserUpdated={setUser}
            onBackHome={handleGoHome}
            onOpenAuth={() => openAuthForRole('delivery')}
          />
        )}

        {view === 'admin' && (
          <AdminDashboard
            language={language}
            cities={cities}
            fbUser={fbUser}
            onBackHome={handleGoHome}
          />
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-8 py-6 text-xs text-slate-500">
          <p>
            © {new Date().getFullYear()} Kisan Mitra · Direct Farm-to-Buyer Bulk Produce Network
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <button type="button" onClick={handleGoHome} className="hover:text-slate-900">
              {t(language, 'navMarketplace')}
            </button>
            <button type="button" onClick={() => openAuthForRole('farmer')} className="hover:text-slate-900">
              {t(language, 'roleFarmer')}
            </button>
            <button type="button" onClick={() => openAuthForRole('delivery')} className="hover:text-slate-900">
              {t(language, 'roleDelivery')}
            </button>
            <button type="button" onClick={() => openAuthForRole('customer')} className="hover:text-slate-900">
              {t(language, 'roleCustomer')}
            </button>
            <button type="button" onClick={() => setView('admin')} className="hover:text-slate-900">
              {t(language, 'navAdmin')}
            </button>
          </div>
        </div>
      </footer>

      {/* SMS/OTP Auth Modal */}
      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        language={language}
        onLanguageChange={handleLanguageChange}
        cities={cities}
        initialRole={authRoleHint}
        fbUser={fbUser}
        onAuthenticated={handleAuthenticated}
      />

      {/* Always-Available Live AI Bot */}
      <AiBotDrawer
        isOpen={aiOpen}
        onOpenChange={setAiOpen}
        language={language}
        selectedCity={selectedCity}
        searchQuery={searchQuery}
        prefillPrompt={aiPrefill}
        onClearPrefill={() => setAiPrefill(null)}
      />
    </div>
  );
}
