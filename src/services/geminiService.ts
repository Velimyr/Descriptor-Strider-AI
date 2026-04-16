import { GoogleGenAI, Type } from "@google/genai";
import { TableColumn } from "../types";
import { getColumnLabel } from "../lib/tableColumns";

export class GeminiService {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-3-flash-preview") {
    console.log(`GeminiService initialized with model: ${model}`);
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async processPage(
    imageBase64: string,
    tableStructure: TableColumn[]
  ) {
    const columnsDesc = tableStructure
      .map((c, index) => `"${getColumnLabel(c, index)}" -> ключ "${c.id}"`)
      .join(", ");
    
    const systemInstruction = `Ви професійний архівіст. Ваше завдання - розпізнати ВСІ справи в таблиці на зображенні архівної сторінки. 
      Для кожної справи поверніть дані у форматі JSON. 
      Використовуйте ТОЧНО цю структуру таблиці: ${columnsDesc}. 
      У полі data ключами мають бути саме технічні ключі колонок, а не їхні назви.
      Для кожної колонки заповніть рядок. Якщо значення відсутнє або не читається, поверніть порожній рядок "".
      Якщо текст у будь-якій колонці переноситься на новий рядок, об'єднайте його в один нормалізований рядок без переносів.
      Для кожної справи проаналізуйте заголовок та додайте список тегів (люди, прізвища, населені пункти, установи).
      Також для кожного рядка вкажіть координати bounding box у форматі [ymin, xmin, ymax, xmax] (значення від 0 до 1000).`;

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
    const response = await this.ai.models.generateContent({
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
    });

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

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: {
        parts: [{ text: `Заголовок справи: "${recordTitle}"` }]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema
      }
    });

    try {
      const parsed = JSON.parse(response.text || "{}");
      return parsed.tags || [];
    } catch (e) {
      console.error("Failed to parse tags response:", e);
      return [];
    }
  }
}
