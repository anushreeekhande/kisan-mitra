import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, ArrowUpRight, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { t } from '../lib/i18n';
import type { Language } from '../types';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface AiBotDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  selectedCity: string;
  searchQuery: string;
  prefillPrompt?: string | null;
  onClearPrefill?: () => void;
}

export const AiBotDrawer: React.FC<AiBotDrawerProps> = ({
  isOpen,
  onOpenChange,
  language,
  selectedCity,
  searchQuery,
  prefillPrompt,
  onClearPrefill,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      text:
        language === 'mr'
          ? 'नमस्कार! मी किसान मित्र लाइव्ह AI आहे. आजचा APMC मंडी भाव तपासायचा आहे का, किंवा वेगवेगळ्या शेतकऱ्यांच्या मालाची गुणवत्ता, अंतर आणि रिव्ह्यूची तुलना करायची आहे?'
          : 'Namaste! I am Kisan Mitra Live AI. Ask me for today’s APMC mandi prices in your city, or ask me to compare farmers by product quality, distance, and customer reviews.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const sendPrompt = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;

    const nextHistory: Message[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const res = await apiFetch<{ reply: string }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: trimmed,
          language,
          city: selectedCity,
          searchQuery,
          history: messages,
        }),
      });
      setMessages([...nextHistory, { role: 'model', text: res.reply }]);
    } catch (err) {
      setMessages([
        ...nextHistory,
        {
          role: 'model',
          text:
            err instanceof Error
              ? err.message
              : 'Unable to reach Live AI right now. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && prefillPrompt) {
      sendPrompt(prefillPrompt);
      onClearPrefill?.();
    }
  }, [isOpen, prefillPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const subject = searchQuery.trim() || (language === 'mr' ? 'टोमॅटो' : 'Tomatoes');
  const quickSuggestions =
    language === 'mr'
      ? [
          `${selectedCity} मध्ये आजचा ${subject} चा मंडी बाजार भाव काय आहे?`,
          `${subject} साठी उपलब्ध शेतकऱ्यांची गुणवत्ता, अंतर आणि रिव्ह्यू तुलना करा`,
          `कोणत्या शेतकऱ्याकडे मंडीपेक्षा सर्वात जास्त बचत मिळते?`,
        ]
      : [
          `What is today's mandi price for ${subject} in ${selectedCity}?`,
          `Compare farmers for ${subject} on quality, distance & reviews`,
          `Which nearest farmer gives the best bulk savings today?`,
        ];

  return (
    <>
      {/* Persistent "Ask Live AI" button accessible on EVERY screen */}
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 rounded-xl bg-emerald-900 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-950 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
      >
        <Bot className="h-4 w-4" />
        <span className="whitespace-nowrap">{t(language, 'askLiveAi')}</span>
      </button>

      {/* Slide-over AI Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-xs">
          <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-900 text-white">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {language === 'mr' ? 'किसान मित्र लाइव्ह AI' : 'Kisan Mitra Live AI'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedCity} Mandi · {language === 'mr' ? 'थेट दर व शेतकरी तुलना' : 'Live Mandi & Farmer Comparison'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close AI Advisor"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Suggestion Prompts */}
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-500">
                {language === 'mr' ? 'त्वरित प्रश्न:' : 'Suggested Checks:'}
              </p>
              <div className="flex flex-col gap-1.5">
                {quickSuggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendPrompt(q)}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-800 hover:border-emerald-700 hover:text-emerald-900 transition-colors"
                  >
                    <span className="line-clamp-1">{q}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>

            {/* Message History */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-emerald-900 text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-900'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-800" />
                    <span>
                      {language === 'mr'
                        ? 'मंडी दर आणि शेतकरी माहिती तपासत आहे...'
                        : 'Comparing mandi rates & farmer batches...'}
                    </span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Chat Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendPrompt(input);
              }}
              className="border-t border-slate-200 bg-white p-4"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    language === 'mr'
                      ? 'मंडी भाव किंवा शेतकरी तुलना विचारा...'
                      : 'Ask about mandi prices, quality, or farmers...'
                  }
                  className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-emerald-700 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-800 text-white hover:bg-emerald-900 disabled:opacity-50"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
