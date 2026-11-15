import React, { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { X, ShieldCheck, Smartphone, ArrowRight, CheckCircle2, Cloud } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import {
  confirmFirebaseSmsOtp,
  sendFirebaseSmsOtp,
  signInWithGoogleFirebase,
  syncUserProfileToFirestore,
  recordSignInToFirestore,
  FIREBASE_PROJECT_ID,
  type FirebaseConfirmationResult,
} from '../lib/firebase';
import { t } from '../lib/i18n';
import type { CityHub, Language, User, UserRole } from '../types';

interface DemoAccount {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  city: string;
  area: string;
  farmName?: string | null;
  vehicleType?: string | null;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  cities: CityHub[];
  initialRole?: UserRole;
  fbUser?: FirebaseUser | null;
  onAuthenticated: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  language,
  onLanguageChange,
  cities,
  initialRole = 'customer',
  fbUser,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [role, setRole] = useState<UserRole>(initialRole);
  const [phone, setPhone] = useState('9823022201');
  const [name, setName] = useState('');
  const [city, setCity] = useState('Pune');
  const [area, setArea] = useState('');
  const [farmName, setFarmName] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otp, setOtp] = useState('');
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [smsChannel, setSmsChannel] = useState<'real_sms' | 'firebase_sms' | 'sandbox_preview'>(
    'sandbox_preview'
  );
  const [smsProviderNote, setSmsProviderNote] = useState<string | null>(null);
  const [fbConfirmation, setFbConfirmation] = useState<FirebaseConfirmationResult | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fbBusy, setFbBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    setRole(initialRole);
  }, [initialRole]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (!isOpen) return;
    apiFetch<{ accounts: DemoAccount[] }>('/api/auth/demo-accounts')
      .then((res) => setDemoAccounts(res.accounts))
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const dispatchOtpFlow = async (targetPhone: string, forcePreview = false) => {
    setError(null);
    setDemoOtp(null);
    setSmsProviderNote(null);
    setFbConfirmation(null);
    setOtp('');
    setLoading(true);

    try {
      // 1. Validate phone / registration fields & check if server SMS gateway (Twilio/Fast2SMS/MSG91) is configured
      const checkRes = await apiFetch<{
        success: boolean;
        realSmsActive?: boolean;
        configuredProvider?: string;
        smsMode?: 'real_sms' | 'sandbox_preview';
        demoOtpCode?: string;
      }>('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: targetPhone,
          mode,
          role,
          name,
          city,
          area,
          farmName,
          vehicleType,
          language,
          transport: forcePreview ? 'preview' : 'check_only',
        }),
      });

      // If server-side real SMS gateway is active, dispatch SMS from server immediately
      if (!forcePreview && checkRes.realSmsActive) {
        const smsRes = await apiFetch<{
          success: boolean;
          smsMode: 'real_sms' | 'sandbox_preview';
          provider: string;
          message: string;
        }>('/api/auth/send-otp', {
          method: 'POST',
          body: JSON.stringify({
            phone: targetPhone,
            mode,
            role,
            name,
            city,
            area,
            farmName,
            vehicleType,
            language,
            transport: 'auto',
          }),
        });
        setSmsChannel('real_sms');
        setSmsProviderNote(smsRes.message);
        setResendSeconds(30);
        setStep('otp');
        return;
      }

      // 2. Try Firebase Phone Auth real SMS OTP delivery to the mobile number
      if (!forcePreview) {
        try {
          const confirmation = await sendFirebaseSmsOtp(targetPhone, 'km-recaptcha-container');
          setFbConfirmation(confirmation);
          setSmsChannel('firebase_sms');
          setSmsProviderNote(
            language === 'mr'
              ? `+91 ${targetPhone} वर खरा SMS OTP पाठवला आहे. तुमच्या मोबाईलवरील ६-अंकी कोड टाका.`
              : `Real SMS OTP sent to +91 ${targetPhone} via Firebase Phone Auth. Enter the 6-digit code from your phone.`
          );
          setResendSeconds(30);
          setStep('otp');
          return;
        } catch (fbErr) {
          const fbMsg = fbErr instanceof Error ? fbErr.message : 'Firebase Phone SMS unavailable';
          // Fall back to server OTP sandbox if Firebase Phone Auth isn't enabled yet on console
          const fallbackRes = await apiFetch<{
            success: boolean;
            demoOtpCode?: string;
            message: string;
          }>('/api/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({
              phone: targetPhone,
              mode,
              role,
              name,
              city,
              area,
              farmName,
              vehicleType,
              language,
              transport: 'preview',
            }),
          });
          setSmsChannel('sandbox_preview');
          setDemoOtp(fallbackRes.demoOtpCode || null);
          setSmsProviderNote(fbMsg);
          setResendSeconds(30);
          setStep('otp');
          return;
        }
      }

      // 3. Explicit preview/demo account dispatch
      const previewRes = await apiFetch<{
        success: boolean;
        demoOtpCode?: string;
      }>('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: targetPhone,
          mode,
          role,
          name,
          city,
          area,
          farmName,
          vehicleType,
          language,
          transport: 'preview',
        }),
      });
      setSmsChannel('sandbox_preview');
      setDemoOtp(previewRes.demoOtpCode || null);
      if (forcePreview && previewRes.demoOtpCode) {
        setOtp(previewRes.demoOtpCode);
      }
      setResendSeconds(30);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatchOtpFlow(phone, false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let res: { token: string; user: User };
      let activeFbUser = fbUser || null;

      if (smsChannel === 'firebase_sms' && fbConfirmation) {
        activeFbUser = await confirmFirebaseSmsOtp(fbConfirmation, otp);
        const idToken = await activeFbUser.getIdToken();
        res = await apiFetch<{ token: string; user: User }>('/api/auth/phone-firebase-login', {
          method: 'POST',
          body: JSON.stringify({
            idToken,
            role,
            name,
            city,
            area,
            farmName,
            vehicleType,
            language,
          }),
        });
      } else {
        res = await apiFetch<{ token: string; user: User }>('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ phone, otp }),
        });
      }

      setAuthToken(res.token);
      if (activeFbUser) {
        await syncUserProfileToFirestore(res.user, activeFbUser).catch(() => {});
        await recordSignInToFirestore(res.user, 'sms_otp', activeFbUser).catch(() => {});
      }
      onAuthenticated(res.user);
      setStep('phone');
      setOtp('');
      setDemoOtp(null);
      setFbConfirmation(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoSelect = async (acc: DemoAccount) => {
    setMode('login');
    setRole(acc.role);
    setPhone(acc.phone);
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ demoOtpCode?: string }>('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: acc.phone, mode: 'login', transport: 'preview' }),
      });
      setSmsChannel('sandbox_preview');
      setFbConfirmation(null);
      setSmsProviderNote(null);
      setDemoOtp(res.demoOtpCode || null);
      setOtp(res.demoOtpCode || '');
      setResendSeconds(30);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare demo OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleConnect = async (selectedRole: UserRole = role, forceSelect = false) => {
    setError(null);
    setFbBusy(true);
    try {
      const activeFbUser =
        !forceSelect && fbUser ? fbUser : await signInWithGoogleFirebase(forceSelect);
      const idToken = await activeFbUser.getIdToken();
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/firebase-login', {
        method: 'POST',
        body: JSON.stringify({
          idToken,
          firebaseUid: activeFbUser.uid,
          email: activeFbUser.email,
          name: name.trim() || activeFbUser.displayName,
          role: selectedRole,
          city,
          area: area.trim() || `${city} Central`,
          phone: mode === 'register' && phone.trim().length === 10 ? phone.trim() : undefined,
          farmName,
          vehicleType,
          language,
        }),
      });
      setAuthToken(res.token);
      await syncUserProfileToFirestore(res.user, activeFbUser).catch(() => {});
      await recordSignInToFirestore(res.user, 'google', activeFbUser).catch(() => {});
      onAuthenticated(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setFbBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={t(language, 'loginTitle')}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{t(language, 'loginTitle')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t(language, 'loginSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-6 py-5 space-y-5">
          {/* Language selector inside Login/Registration */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <span className="text-sm font-medium text-slate-700">{t(language, 'languageLabel')}</span>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => onLanguageChange('en')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  language === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => onLanguageChange('mr')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  language === 'mr' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                मराठी
              </button>
            </div>
          </div>

          {/* Primary Google Sign-In Section (with Role Selection) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                <Cloud className="h-4 w-4 text-emerald-800" />
                <span>
                  {language === 'mr'
                    ? 'Google खात्यासह त्वरित साइन इन'
                    : 'Quick Sign-In with Google'}
                </span>
              </span>
              {fbUser?.email && (
                <button
                  type="button"
                  disabled={fbBusy}
                  onClick={() => handleGoogleConnect(role, true)}
                  className="text-[11px] font-medium text-emerald-800 hover:underline disabled:opacity-50"
                >
                  {language === 'mr' ? 'दुसरे खाते निवडा' : 'Switch Google account'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {(['customer', 'farmer', 'delivery'] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`px-2 py-2 text-xs font-medium rounded-lg border text-center transition-colors ${
                    role === r
                      ? 'border-emerald-800 bg-white text-emerald-900 shadow-xs'
                      : 'border-slate-200 bg-slate-100/70 text-slate-600 hover:bg-white'
                  }`}
                >
                  {r === 'customer'
                    ? language === 'mr'
                      ? 'ग्राहक'
                      : 'Customer'
                    : r === 'farmer'
                    ? language === 'mr'
                      ? 'शेतकरी'
                      : 'Farmer'
                    : language === 'mr'
                    ? 'डिलिव्हरी'
                    : 'Delivery'}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={fbBusy}
              onClick={() => handleGoogleConnect(role, false)}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:border-emerald-800 hover:bg-emerald-50/40 disabled:opacity-50 transition-colors"
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
                {fbBusy
                  ? '...'
                  : fbUser?.email
                  ? `${t(language, 'continueWithGoogle')} (${fbUser.email})`
                  : `${t(language, 'continueWithGoogle')} (${
                      role === 'customer'
                        ? language === 'mr'
                          ? 'ग्राहक'
                          : 'Customer'
                        : role === 'farmer'
                        ? language === 'mr'
                          ? 'शेतकरी'
                          : 'Farmer'
                        : language === 'mr'
                        ? 'डिलिव्हरी'
                        : 'Delivery Agent'
                    })`}
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="relative flex items-center py-0.5">
            <div className="grow border-t border-slate-200" />
            <span className="mx-3 shrink-0 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              {language === 'mr' ? 'किंवा SMS OTP वापरा' : 'or use SMS OTP'}
            </span>
            <div className="grow border-t border-slate-200" />
          </div>

          {/* Login vs Register Segmented Control */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setStep('phone');
                setError(null);
              }}
              className={`py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t(language, 'modeLogin')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setStep('phone');
                setPhone('');
                setError(null);
              }}
              className={`py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t(language, 'modeRegister')}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {step === 'phone' ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      {language === 'mr' ? 'भूमिका निवडा' : 'Account Role'}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['customer', 'farmer', 'delivery'] as UserRole[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={`px-3 py-2.5 text-xs font-medium rounded-lg border text-center transition-colors ${
                            role === r
                              ? 'border-emerald-800 bg-emerald-50 text-emerald-900'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {r === 'customer'
                            ? t(language, 'roleCustomer')
                            : r === 'farmer'
                            ? t(language, 'roleFarmer')
                            : t(language, 'roleDelivery')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {t(language, 'fullNameLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={language === 'mr' ? 'उदा. अमोल देशमुख' : 'e.g. Amol Deshmukh'}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {t(language, 'cityLabel')}
                      </label>
                      <select
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none bg-white"
                      >
                        {cities.map((c) => (
                          <option key={c.city} value={c.city}>
                            {c.city}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t(language, 'areaLabel')}
                    </label>
                    <input
                      type="text"
                      required
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder={language === 'mr' ? 'उदा. नारायणगाव / कोथरूड' : 'e.g. Narayangaon / Kothrud'}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                    />
                  </div>

                  {role === 'farmer' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {t(language, 'farmNameLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={farmName}
                        onChange={(e) => setFarmName(e.target.value)}
                        placeholder="e.g. Sahyadri Krishi Farms"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                      />
                    </div>
                  )}

                  {role === 'delivery' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {t(language, 'vehicleLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value)}
                        placeholder="e.g. Tata Ace Gold (1.5 Ton)"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t(language, 'phoneLabel')}
                </label>
                <div className="flex items-center rounded-lg border border-slate-300 focus-within:border-emerald-700">
                  <span className="border-r border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-600">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="9823022201"
                    className="w-full px-3 py-2.5 font-mono text-sm focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
              >
                <Smartphone className="h-4 w-4" />
                <span>{loading ? '...' : t(language, 'sendOtp')}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {smsChannel !== 'sandbox_preview' ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 space-y-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                    <span>
                      {language === 'mr'
                        ? `+91 ${phone} वर SMS OTP पाठवला आहे`
                        : `SMS OTP sent to +91 ${phone}`}
                    </span>
                  </div>
                  {smsProviderNote && <p className="text-xs text-emerald-800">{smsProviderNote}</p>}
                </div>
              ) : (
                demoOtp && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 space-y-1.5">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                      <span>
                        {language === 'mr'
                          ? `+91 ${phone} साठी ६-अंकी पडताळणी OTP:`
                          : `6-digit SMS verification OTP for +91 ${phone}:`}
                      </span>
                    </div>
                    <p className="font-mono text-lg font-semibold tracking-widest text-emerald-950 tabular-nums">
                      {demoOtp}
                    </p>
                    {smsProviderNote && (
                      <p className="text-[11px] text-slate-600">{smsProviderNote}</p>
                    )}
                  </div>
                )
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-700">
                    {t(language, 'otpLabel')}
                  </label>
                  <button
                    type="button"
                    disabled={loading || resendSeconds > 0}
                    onClick={() => dispatchOtpFlow(phone, false)}
                    className="text-xs font-semibold text-emerald-800 hover:underline disabled:text-slate-400 disabled:no-underline"
                  >
                    {resendSeconds > 0
                      ? language === 'mr'
                        ? `पुन्हा पाठवा (${resendSeconds}s)`
                        : `Resend OTP in ${resendSeconds}s`
                      : language === 'mr'
                      ? 'OTP पुन्हा पाठवा'
                      : 'Resend SMS OTP'}
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit OTP"
                  className="w-full rounded-lg border border-slate-300 px-3 py-3 text-center font-mono text-lg tracking-widest focus:border-emerald-700 focus:outline-none tabular-nums"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setOtp('');
                    setDemoOtp(null);
                    setError(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {language === 'mr' ? 'मागे' : 'Change Number'}
                </button>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>{loading ? '...' : t(language, 'verifyOtp')}</span>
                </button>
              </div>
            </form>
          )}

          {/* Quick Verified Demo Role Switcher */}
          {demoAccounts.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <p className="text-xs font-medium text-slate-500 mb-2.5">
                {language === 'mr'
                  ? 'जलद तपासणीसाठी नोंदणीकृत खाती (OTP सह):'
                  : 'Quick OTP Sign-In with Verified Accounts:'}
              </p>
              <div className="grid grid-cols-1 gap-2">
                {demoAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => handleQuickDemoSelect(acc)}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:border-emerald-700 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <span className="font-semibold text-slate-900">{acc.name}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="capitalize text-emerald-800 font-medium">{acc.role}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="text-slate-500">
                        {acc.farmName || acc.vehicleType || acc.area} ({acc.city})
                      </span>
                    </div>
                    <span className="font-mono text-slate-600 tabular-nums">+91 {acc.phone}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div id="km-recaptcha-container" />
          <p className="text-[11px] text-slate-500 text-center">
            {language === 'mr'
              ? `खाते व साइन-इन नोंदी Firebase (${FIREBASE_PROJECT_ID}) मध्ये सुरक्षित जतन केल्या जातात.`
              : `Sign-in records and role profiles sync securely with Cloud Firestore (${FIREBASE_PROJECT_ID}).`}
          </p>
        </div>
      </div>
    </div>
  );
};
