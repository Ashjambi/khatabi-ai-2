
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../App';
import { Letter, LetterType, Tone, PriorityLevel, ConfidentialityLevel, GeneratorState, LetterVariations, SmartReply } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { generateSmartReplies } from '../services/geminiService';
import { toast } from 'react-hot-toast';
import { getThemeClasses, sanitizeHTML } from './utils';
import RichTextEditor from './RichTextEditor';
import MultiSelectCombobox from './MultiSelectCombobox';
import { SparklesIcon, FileTextIcon, BotIcon, InboxInIcon, CheckCircleIcon, ArrowRightLeftIcon, Undo2Icon, MessageSquareIcon } from './icons';

interface LetterAnalysis {
    strategic_feedback: string[];
}

export default function LetterGenerator() {
    const { state, dispatch } = useApp();
    const { generatorState, learnedPrinciples, companySettings, letters } = state;
    const {
        sender, receiver, subject, cc, priority, confidentiality,
        completionDays, notes, tone, letterType, originalLetterContent, referenceId, objective
    } = generatorState;

    const theme = getThemeClasses(companySettings.primaryColor);
    const [step, setStep] = useState(0); 
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingReplies, setIsLoadingReplies] = useState(false);
    const [smartReplies, setSmartReplies] = useState<SmartReply[]>([]);
    const [generatedContent, setGeneratedContent] = useState<{variations: LetterVariations, analysis: LetterAnalysis} | null>(null);
    const [finalBody, setFinalBody] = useState('');
    const [objectiveText, setObjectiveText] = useState(objective || '');
    const [isContextCollapsed, setIsContextCollapsed] = useState(false);

    const parentLetter = useMemo(() => letters.find(l => l.id === referenceId), [letters, referenceId]);
    const isReplyMode = !!referenceId;

    useEffect(() => {
        if (isReplyMode && parentLetter) {
            const fetchReplies = async () => {
                setIsLoadingReplies(true);
                try {
                    const replies = await generateSmartReplies(parentLetter);
                    setSmartReplies(replies);
                } catch (e) {
                    console.error("Smart replies failed", e);
                } finally {
                    setIsLoadingReplies(false);
                }
            };
            fetchReplies();
        }
    }, [referenceId, parentLetter]);

    useEffect(() => { 
        if (objective) setObjectiveText(objective); 
    }, [objective]);

    const updateState = (payload: Partial<GeneratorState>) => {
        dispatch({ type: 'UPDATE_GENERATOR_STATE', payload });
    };

    const handleGenerate = async () => {
        if (!objectiveText.trim()) {
            toast.error("الرجاء إدخال التوجيهات أو اختيار مسار رد.");
            return;
        }

        setIsLoading(true);
        try {
            // تهيئة مباشرة لضمان الحصول على مفتاح API من البيئة
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const systemInstruction = `أنت خبير الصياغة الإدارية. 
            قاعدة لغوية قطعية: يجب أن تكون جميع النصوص العربية بكلمات متصلة وطبيعية (يُمنع منعاً باتاً فصل الحروف). 
            المهمة: إنشاء 3 مسودات (رسمية، حازمة، دبلوماسية) بصيغة HTML.`;

            const userPrompt = isReplyMode 
                ? `رد على خطاب: ${originalLetterContent}. التوجيه: ${objectiveText}. من ${sender} إلى ${receiver}.`
                : `أنشئ خطاباً جديداً: الموضوع: ${subject}. المحتوى: ${objectiveText}.`;

            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: { parts: [{ text: userPrompt }] } as any,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            analysis: { type: Type.OBJECT, properties: { strategic_feedback: { type: Type.ARRAY, items: { type: Type.STRING } } } },
                            variations: {
                                type: Type.OBJECT,
                                properties: { neutral: { type: Type.STRING }, strict: { type: Type.STRING }, diplomatic: { type: Type.STRING } },
                                required: ["neutral", "strict", "diplomatic"]
                            }
                        }
                    }
                }
            });

            if (!response.text) throw new Error("EMPTY_RESPONSE");
            setGeneratedContent(JSON.parse(response.text.trim()));
            setStep(1);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message?.includes("API key") ? "خطأ في مفتاح API. تأكد من إعدادات Cloudflare." : "فشلت الصياغة الذكية. يرجى المحاولة لاحقاً.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleFinalSave = () => {
        dispatch({ 
            type: 'CREATE_LETTER', 
            payload: { 
                newLetterData: { 
                    subject, from: sender, to: receiver, body: finalBody, 
                    type: letterType, tone, attachments: [], cc, priority, 
                    confidentiality, completionDays: Number(completionDays) || undefined, notes 
                } 
            } 
        });
        toast.success("تم اعتماد الخطاب وحفظه بنجاح.");
    };

    return (
        <div className="max-w-[1700px] mx-auto pb-12">
            <div className="flex justify-between items-end mb-8 px-2">
                <div>
                    <h2 className="text-3xl font-black text-white tracking-tight">مركز الصياغة والتحليل</h2>
                    <div className="flex items-center gap-3 mt-2">
                         {isReplyMode ? (
                            <span className="bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-lg text-[11px] font-black border border-emerald-500/20 flex items-center gap-2">
                                <BotIcon className="w-3.5 h-3.5" /> نمط الرد الاستراتيجي
                            </span>
                         ) : (
                            <span className="bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-lg text-[11px] font-black border border-indigo-500/20 flex items-center gap-2">
                                <SparklesIcon className="w-3.5 h-3.5" /> نمط الإنشاء الحر
                            </span>
                         )}
                    </div>
                </div>
                {step > 0 && (
                    <button onClick={() => setStep(step - 1)} className="btn-3d-secondary px-5 py-2.5 flex items-center gap-2 text-xs font-black">
                        <Undo2Icon className="w-4 h-4" /> العودة للتعديل
                    </button>
                )}
            </div>

            <div className={`grid grid-cols-1 ${isReplyMode ? 'lg:grid-cols-12' : ''} gap-8`}>
                
                {isReplyMode && parentLetter && (
                    <div className={`${isContextCollapsed ? 'lg:col-span-1' : 'lg:col-span-4'} transition-all duration-500`}>
                        <div className="glass-card sticky top-6 border-indigo-500/20 bg-slate-950/40 overflow-hidden shadow-2xl rounded-3xl">
                            <div className="p-4 bg-indigo-500/10 border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <InboxInIcon className="w-5 h-5 text-indigo-400" />
                                    {!isContextCollapsed && <span className="font-black text-[11px] text-indigo-300 uppercase tracking-widest">الخطاب المرجعي</span>}
                                </div>
                                <button onClick={() => setIsContextCollapsed(!isContextCollapsed)} className="p-1.5 hover:bg-white/10 rounded-lg">
                                    <ArrowRightLeftIcon className={`w-4 h-4 text-slate-500 ${isContextCollapsed ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                            
                            {!isContextCollapsed && (
                                <div className="p-6 space-y-6 animate-in fade-in duration-500">
                                    <h3 className="text-lg font-black text-white leading-snug">{parentLetter.subject}</h3>
                                    <div className="bg-slate-950/70 p-5 rounded-2xl border border-white/10 shadow-inner max-h-[400px] overflow-y-auto custom-scrollbar">
                                        <div className="text-[14px] text-slate-300 font-bold leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizeHTML(parentLetter.body) }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className={`${isReplyMode ? (isContextCollapsed ? 'lg:col-span-11' : 'lg:col-span-8') : 'max-w-5xl mx-auto w-full'} transition-all duration-500`}>
                    
                    {step === 0 && (
                        <div className="glass-card p-8 space-y-8 border-white/10 rounded-3xl shadow-3xl">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-950/40 p-6 rounded-3xl border border-white/5 shadow-inner">
                                <input type="text" value={sender} onChange={e => updateState({ sender: e.target.value })} className="w-full bg-transparent border-none text-slate-200 font-bold text-base p-0 focus:ring-0" placeholder="من..." />
                                <input type="text" value={receiver} onChange={e => updateState({ receiver: e.target.value })} className="w-full bg-transparent border-none text-slate-200 font-bold text-base p-0 focus:ring-0" placeholder="إلى..." />
                                <div className="md:col-span-2 pt-4 border-t border-white/5">
                                    <input type="text" value={subject} onChange={e => updateState({ subject: e.target.value })} className="w-full bg-transparent border-none text-indigo-400 font-black text-xl p-0 focus:ring-0" placeholder="موضوع الخطاب..." />
                                </div>
                            </div>

                            <textarea 
                                value={objectiveText} 
                                onChange={e => setObjectiveText(e.target.value)}
                                rows={5}
                                className="w-full input-inset p-6 rounded-2xl text-base font-bold leading-relaxed shadow-2xl transition-all bg-slate-950/20"
                                placeholder="اشرح هنا ما تريد تحقيقه..."
                            />
                            
                            {isReplyMode && (
                                <div className="space-y-4">
                                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest px-1">مسارات استراتيجية مقترحة</p>
                                    <div className="flex flex-col gap-2.5">
                                        {smartReplies.map((reply, i) => (
                                            <button key={i} onClick={() => { setObjectiveText(reply.objective); updateState({ tone: reply.tone as Tone }); }} className={`p-4 rounded-xl border text-right transition-all group ${objectiveText === reply.objective ? 'bg-indigo-600 border-indigo-400' : 'bg-white/5 border-white/5 hover:border-indigo-500/40'}`}>
                                                <span className={`text-[10px] font-black block mb-1 ${objectiveText === reply.objective ? 'text-white' : 'text-slate-500'}`}>{reply.title}</span>
                                                <p className={`text-[13px] font-bold ${objectiveText === reply.objective ? 'text-white' : 'text-slate-200'}`}>{reply.objective}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-center pt-4">
                                <button onClick={handleGenerate} disabled={isLoading || !objectiveText.trim()} className={`px-16 py-5 rounded-2xl font-black text-xl flex items-center gap-4 transition-all shadow-xl active:scale-95 ${isLoading ? 'bg-slate-700' : theme.bg + ' text-white hover:brightness-110'}`}>
                                    {isLoading ? <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div> : <SparklesIcon className="w-8 h-8" />}
                                    <span>توليد المسودات الذكية</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 1 && generatedContent && (
                        <div className="space-y-8 animate-in fade-in duration-500">
                             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {(['neutral', 'strict', 'diplomatic'] as const).map(vKey => (
                                    <div key={vKey} className="bg-slate-900/80 rounded-[2.5rem] border border-white/10 overflow-hidden flex flex-col hover:border-indigo-500/50 transition-all">
                                        <div className="p-5 bg-white/5 border-b border-white/10 text-center font-black text-white text-sm uppercase">
                                            {vKey === 'neutral' ? 'معتدلة' : vKey === 'strict' ? 'حازمة' : 'دبلوماسية'}
                                        </div>
                                        <div className="p-6 flex-grow text-white text-base leading-relaxed font-bold overflow-y-auto max-h-[450px] text-right prose prose-invert prose-sm" dangerouslySetInnerHTML={{ __html: sanitizeHTML(generatedContent.variations[vKey]) }} />
                                        <div className="p-5">
                                            <button onClick={() => { setFinalBody(generatedContent.variations[vKey]); setStep(2); }} className={`w-full py-3.5 rounded-xl font-black text-sm text-white ${theme.bg}`}>اختيار هذه النسخة</button>
                                        </div>
                                    </div>
                                ))}
                             </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-in duration-700">
                             <RichTextEditor value={finalBody} onChange={setFinalBody} ringColor={theme.ring} minHeight="min-h-[600px]" />
                             <button onClick={handleFinalSave} className="w-full py-6 font-black text-xl flex items-center justify-center gap-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl shadow-xl transition-all">
                                <CheckCircleIcon className="w-8 h-8" />
                                <span>حفظ واعتماد المعاملة</span>
                             </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
