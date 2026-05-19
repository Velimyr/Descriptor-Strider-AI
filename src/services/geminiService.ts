import { GoogleGenAI, Type } from "@google/genai";
import { TableColumn } from "../types";
import { getColumnLabel } from "../lib/tableColumns";

export interface GeminiKeyRotationInfo {
  fromIndex: number;
  toIndex: number;
  totalKeys: number;
  attempt: number;
  reason: string;
}

export interface GeminiServiceOptions {
  keys: string[];
  model?: string;
  retryIntervalMs?: number;
  onKeyRotate?: (info: GeminiKeyRotationInfo) => void;
}

export class GeminiService {
  private keys: string[];
  private model: string;
  private currentIndex: number;
  private retryIntervalMs: number;
  private onKeyRotate?: (info: GeminiKeyRotationInfo) => void;

  constructor(options: GeminiServiceOptions | string, modelArg?: string) {
    if (typeof options === "string") {
      this.keys = options ? [options] : [];
      this.model = modelArg || "gemini-3-flash-preview";
      this.retryIntervalMs = 3000;
      this.currentIndex = 0;
    } else {
      this.keys = (options.keys || []).filter(k => typeof k === "string" && k.trim().length > 0);
      this.model = options.model || "gemini-3-flash-preview";
      this.retryIntervalMs = options.retryIntervalMs ?? 3000;
      this.onKeyRotate = options.onKeyRotate;
      this.currentIndex = 0;
    }
    console.log(`GeminiService initialized with model: ${this.model}, keys count: ${this.keys.length}, retry interval: ${this.retryIntervalMs}ms`);
  }

  getCurrentKeyIndex() {
    return this.currentIndex;
  }

  getKeysCount() {
    return this.keys.length;
  }

  private async callWithRotation<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
    if (this.keys.length === 0) {
      throw new Error("Не задано жодного Gemini API ключа");
    }

    const totalKeys = this.keys.length;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalKeys; attempt++) {
      const idx = this.currentIndex;
      const ai = new GoogleGenAI({ apiKey: this.keys[idx] });
      try {
        return await fn(ai);
      } catch (err) {
        lastError = err;
        if (attempt < totalKeys) {
          const nextIdx = (idx + 1) % totalKeys;
          const reason = err instanceof Error ? err.message : String(err);
          this.currentIndex = nextIdx;
          this.onKeyRotate?.({
            fromIndex: idx,
            toIndex: nextIdx,
            totalKeys,
            attempt,
            reason
          });
          if (this.retryIntervalMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.retryIntervalMs));
          }
        }
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(String(lastError));
  }

  async processPage(
    imageBase64: string,
    tableStructure: TableColumn[]
  ) {
    const columnsDesc = tableStructure
      .map((c, index) => `"${getColumnLabel(c, index)}" -> ключ "${c.id}"`)
      .join(", ");

    const roleRules: string[] = [];

    const noColumns = tableStructure.filter(c => c.role === 'order_no' || c.role === 'case_no');
    const dateColumns = tableStructure.filter(c => c.role === 'year_range' || c.role === 'date_start' || c.role === 'date_end');
    const pageCountColumns = tableStructure.filter(c => c.role === 'page_count');

    if (noColumns.length > 0) {
      const cols = noColumns.map(c => `"${getColumnLabel(c, tableStructure.indexOf(c))}" (ключ "${c.id}")`).join(', ');
      roleRules.push(`Для колонок ${cols}: значення може містити лише цифри та літери (кириличні або латинські). Видаляй крапки, коми, пробіли та будь-які інші зайві символи. Приклад: "12а", "547Б" — правильно; "12.", "1 2", "547," — неправильно.`);
    }

    if (dateColumns.length > 0) {
      const cols = dateColumns.map(c => `"${getColumnLabel(c, tableStructure.indexOf(c))}" (ключ "${c.id}")`).join(', ');
      roleRules.push(`Для колонок ${cols}: нормалізуй значення як дату або діапазон дат. Допустимі формати: ДД.ММ.РРРР, РРРР, "XVIII ст.", "кін. XVIII ст.", "поч. XIX ст." тощо. Діапазон записуй через тире: РРРР–РРРР, ДД.ММ.РРРР–ДД.ММ.РРРР або "XVIII–XIX ст.". Зберігай уточнення типу "поч.", "кін.", "сер." якщо вони є. Видаляй лише зайві дужки та сторонні символи, що не є частиною дати.`);
    }

    if (pageCountColumns.length > 0) {
      const cols = pageCountColumns.map(c => `"${getColumnLabel(c, tableStructure.indexOf(c))}" (ключ "${c.id}")`).join(', ');
      roleRules.push(`Для колонок ${cols}: записуй лише ціле число без слів, одиниць виміру та інших символів. Приклад: "47" — правильно; "47 арк.", "47 л.", "47." — неправильно.`);
    }

    const rulesBlock = roleRules.length > 0
      ? '\nДодаткові правила нормалізації:\n' + roleRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '';

    const systemInstruction = `Ви професійний архівіст. Ваше завдання - розпізнати ВСІ справи в таблиці на зображенні архівної сторінки.
      Для кожної справи поверніть дані у форматі JSON.
      Використовуйте ТОЧНО цю структуру таблиці: ${columnsDesc}.
      У полі data ключами мають бути саме технічні ключі колонок, а не їхні назви.
      Для кожної колонки заповніть рядок. Якщо значення відсутнє або не читається, поверніть порожній рядок "".
      Якщо текст у будь-якій колонці переноситься на новий рядок, об'єднайте його в один нормалізований рядок без переносів.
      Для кожної справи проаналізуйте заголовок та додайте список тегів (люди, прізвища, населені пункти, установи).
      Також для кожного рядка вкажіть координати bounding box у форматі [ymin, xmin, ymax, xmax] (значення від 0 до 1000).${rulesBlock}`;

    const responseSchema: any = {
      type: Type.OBJECT,
      properties: {
        results: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              data: {
                type: Type.OBJECT,
                properties: tableStructure.reduce((acc, col) => {
                  acc[col.id] = { type: Type.STRING };
                  return acc;
                }, {} as any),
                required: tableStructure.map(c => c.id)
              },
              boundingBox: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: "[ymin, xmin, ymax, xmax]"
              },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["data", "boundingBox"]
          }
        }
      },
      required: ["results"]
    };

    console.log(`GeminiService processing page with model: ${this.model}`);
    const response = await this.callWithRotation(ai => ai.models.generateContent({
      model: this.model,
      contents: {
        parts: [
          { text: "Опрацюй цю сторінку архівної таблиці." },
          { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    }));

    const text = response.text;

    try {
      const parsed = JSON.parse(text || "{}");
      return parsed.results || [];
    } catch (e) {
      console.error("Failed to parse Gemini response:", e);
      return [];
    }
  }

  async generateTags(recordTitle: string) {
    const systemInstruction = `Ви професійний архівіст. Ваше завдання - проаналізувати заголовок архівної справи та виділити список "тегів".
    Теги - це нормалізовані назви власних імен (люди, прізвища), населених пунктів, значних локацій, установ.
    Поверніть результат у форматі JSON зі списком рядків.
    Приклад: "Привилей кн. Федора Ивановича Ярославовича на им. Особовичи Пинского пов." -> ["Федор Иванович Ярославович", "Особовичи", "Пинский повет"]`;

    const responseSchema: any = {
      type: Type.OBJECT,
      properties: {
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      },
      required: ["tags"]
    };

    const response = await this.callWithRotation(ai => ai.models.generateContent({
      model: this.model,
      contents: {
        parts: [{ text: `Заголовок справи: "${recordTitle}"` }]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    }));

    try {
      const parsed = JSON.parse(response.text || "{}");
      return parsed.tags || [];
    } catch (e) {
      console.error("Failed to parse tags response:", e);
      return [];
    }
  }
}
