import { GoogleGenAI, Type } from "@google/genai";
import { TableColumn } from "../types";

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
    tableStructure: TableColumn[],
    scenario: 'search' | 'full',
    keywords: string[] = []
  ) {
    const columnsDesc = tableStructure.map(c => c.label).join(", ");
    
    let systemInstruction = "";
    if (scenario === 'search') {
      systemInstruction = `Ви професійний архівіст. Ваше завдання - розпізнати таблицю на зображенні архівної сторінки та знайти справи, що стосуються ключових слів: ${keywords.join(", ")}. 
      Для кожної знайденої справи поверніть дані у форматі JSON. 
      Структура таблиці: ${columnsDesc}. 
      Також для кожного рядка вкажіть координати bounding box у форматі [ymin, xmin, ymax, xmax] (значення від 0 до 1000).`;
    } else {
      systemInstruction = `Ви професійний архівіст. Ваше завдання - розпізнати ВСІ справи в таблиці на зображенні архівної сторінки. 
      Для кожної справи поверніть дані у форматі JSON. 
      Структура таблиці: ${columnsDesc}. 
      Для кожної справи проаналізуйте заголовок та додайте список тегів (люди, прізвища, населені пункти, установи).
      Також для кожного рядка вкажіть координати bounding box у форматі [ymin, xmin, ymax, xmax] (значення від 0 до 1000).`;
    }

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
                items: { type: Type.STRING },
                description: "Тільки для сценарію 'full'"
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
          { inlineData: { mimeType: "image/png", data: imageBase64 } }
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
}
