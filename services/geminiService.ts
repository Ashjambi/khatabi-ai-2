
import { GoogleGenAI, Type } from "@google/genai";
import { Letter, ExtractedLetterDetails, EnhancementSuggestion, FollowUpItem, SmartReply, Tone, SmartSearchResult } from "../types";

// قاعدة لغوية قطعية لمنع تقطيع الحروف العربية في كافة المخرجات
const ARABIC_STRICT_CONNECTED_SCRIPT = `
قاعدة لغوية صارمة جداً (Linguistic Enforcement):
يجب أن تكون جميع النصوص العربية بكلمات متصلة وطبيعية تماماً. 
يُمنع منعاً باتاً فصل الحروف (مثال: اكتب "خطاب" وليس "خ ط ا ب"). 
استخدم الخط العربي المتصل القياسي فقط.
`;

export async function extractDetailsFromLetterImage(
  base64Image: string,
  mimeType: string,
  departments: string[],
  letterTypes: string[],
  priorityLevels: string[],
  confidentialityLevels: string[],
  existingCategories: string[],
  existingLetters: { id: string, subject: string, internalRefNumber?: string, externalRefNumber?: string, date: string }[]
): Promise<ExtractedLetterDetails> {
  // تهيئة مباشرة داخل الوظيفة لضمان استبدال المتغير أثناء الـ Build
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const lettersContext = existingLetters.map(l => 
    `- ID: "${l.id}", Ref: "${l.internalRefNumber || ''}", ExtRef: "${l.externalRefNumber || ''}", Subject: "${l.subject}", Date: "${l.date}"`
  ).join('\n');

  const systemInstruction = `أنت خبير OCR وإدارة مستندات إدارية. استخلص البيانات من الصورة بدقة عالية.
  ${ARABIC_STRICT_CONNECTED_SCRIPT}
  
  **المهام:**
  1. استخرج الحقول المطلوبة كـ JSON.
  2. طابق المستند مع السياق التالي إذا وجد ارتباط:
  ${lettersContext}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
          parts: [
              { text: `حلل الصورة واستخرج البيانات بصيغة JSON.` },
              { inlineData: { mimeType, data: base64Image.replace(/\s/g, '') } } // تنظيف البيانات من المسافات
          ]
      },
      config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
              type: Type.OBJECT,
              properties: {
                  subject: { type: Type.STRING },
                  from: { type: Type.STRING },
                  to: { type: Type.STRING },
                  date: { type: Type.STRING },
                  externalRefNumber: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  category: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  confidentiality: { type: Type.STRING },
                  referenceId: { type: Type.STRING }
              },
              required: ["subject", "from"]
          }
      }
    });

    if (!response.text) throw new Error("API_KEY_NOT_INJECTED_OR_INVALID");
    return JSON.parse(response.text.trim()) as ExtractedLetterDetails;
  } catch (error: any) {
    console.error("Gemini Error:", error);
    if (error.message?.includes("API key")) {
        throw new Error("لم يتم العثور على مفتاح API. يرجى التأكد من إضافته في إعدادات Build variables في Cloudflare وإعادة النشر (Redeploy).");
    }
    throw error;
  }
}

export async function generateSmartReplies(letter: Letter): Promise<SmartReply[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const content = letter.summary || letter.body.replace(/<[^>]*>?/gm, ' ');
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `اقترح 3 مسارات استراتيجية ذكية للرد على هذا الخطاب (الموضوع: ${letter.subject}). 
            المحتوى: ${content}.`,
            config: {
                systemInstruction: `أنت مستشار إداري خبير. اقترح مسارات رد مهنية متنوعة. ${ARABIC_STRICT_CONNECTED_SCRIPT}`,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            objective: { type: Type.STRING },
                            tone: { type: Type.STRING },
                            type: { type: Type.STRING, enum: ["positive", "negative", "neutral", "inquiry"] }
                        },
                        required: ["title", "objective", "tone", "type"]
                    }
                }
            }
        });
        return JSON.parse(response.text || "[]") as SmartReply[];
    } catch (e) {
        return [];
    }
}

export async function enhanceLetter(text: string): Promise<EnhancementSuggestion[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `راجع النص التالي وقدم اقتراحات لتحسين صياغته الإدارية:\n\n${text}`,
            config: {
                systemInstruction: `أنت مدقق لغوي إداري. ${ARABIC_STRICT_CONNECTED_SCRIPT}`,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            original_part: { type: Type.STRING },
                            suggested_improvement: { type: Type.STRING },
                            reason: { type: Type.STRING }
                        },
                        required: ["original_part", "suggested_improvement", "reason"]
                    }
                }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (e) {
        return [];
    }
}

export async function summarizeCorrespondenceThread(thread: Letter[]): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const threadText = thread.map(l => `${l.from} -> ${l.to}: ${l.subject}\n${l.body.replace(/<[^>]*>?/gm, ' ')}`).join('\n---\n');

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `لخص هذه السلسلة في فقرة واحدة مركزة:\n\n${threadText}`,
            config: { systemInstruction: `أنت خبير تلخيص معاملات. ${ARABIC_STRICT_CONNECTED_SCRIPT}`, temperature: 0.2 }
        });
        return response.text || "";
    } catch (e) {
        return "تعذر التلخيص حالياً.";
    }
}

export async function getFollowUpSummary(letters: Letter[]): Promise<FollowUpItem[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const summaries = letters.map(l => ({ id: l.id, subject: l.subject }));
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `حلل القائمة وحدد المعاملات التي تحتاج متابعة عاجلة:\n\n${JSON.stringify(summaries)}`,
            config: {
                systemInstruction: `أنت مساعد متابعة إداري. ${ARABIC_STRICT_CONNECTED_SCRIPT}`,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            letterId: { type: Type.STRING },
                            summary: { type: Type.STRING }
                        }
                    }
                }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (e) {
        return [];
    }
}

export async function searchLettersSmartly(query: string, letters: Letter[]): Promise<SmartSearchResult[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const list = letters.map(l => ({ id: l.id, subject: l.subject }));
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `ابحث سياقياً عن "${query}" في قائمة المعاملات التالية وقيم مدى الارتباط:\n\n${JSON.stringify(list)}`,
            config: {
                systemInstruction: `أنت خبير بحث سياقي. ${ARABIC_STRICT_CONNECTED_SCRIPT}`,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            letterId: { type: Type.STRING },
                            relevanceReason: { type: Type.STRING },
                            confidenceScore: { type: Type.NUMBER }
                        },
                        required: ["letterId", "relevanceReason", "confidenceScore"]
                    }
                }
            }
        });
        return JSON.parse(response.text || "[]");
    } catch (e) {
        return [];
    }
}
