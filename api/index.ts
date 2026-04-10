import express from "express";
import axios from "axios";
import { google } from "googleapis";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Proxy for PDF files to avoid CORS
app.get("/api/proxy-pdf", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).send("URL is required");

  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    res.set("Content-Type", "application/pdf");
    res.send(response.data);
  } catch (error) {
    console.error("Error proxying PDF:", error);
    res.status(500).send("Failed to fetch PDF");
  }
});

// Google Auth URL
app.get("/api/auth/google/url", (req, res) => {
  const redirectUri = req.query.redirectUri as string;
  if (!redirectUri) return res.status(400).send("redirectUri is required");
  
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"],
    prompt: "consent",
    state: redirectUri
  });
  res.json({ url });
});

// Google Auth Callback
app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send("Code is required");
  
  const redirectUri = state as string;
  if (!redirectUri) return res.status(400).send("State (redirectUri) is missing");

  try {
    const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
    const { tokens } = await client.getToken({
      code: code as string,
      redirect_uri: redirectUri
    });
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Authentication failed: " + (error as any).message);
  }
});

// Append to Google Sheets with optional header formatting
app.post("/api/sheets/append", async (req, res) => {
  const { tokens, spreadsheetId, values, sheetName, isHeader } = req.body;
  if (!tokens || !spreadsheetId || !values) return res.status(400).send("Missing parameters");

  const targetSheet = sheetName || "Sheet1";

  try {
    const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === targetSheet) || spreadsheet.data.sheets?.[0];
    const sheetId = sheet?.properties?.sheetId || 0;

    if (isHeader) {
      try {
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `${targetSheet}!A1:Z1000`,
        });
      } catch (e) {
        console.log("Error during clear", e);
      }
    }

    const rows = Array.isArray(values[0]) ? values : [values];
    const processedRows = rows.map(row => 
      row.map(cell => {
        if (typeof cell === 'string' && cell.startsWith('data:image/')) {
          return "[Зображення]";
        }
        return cell;
      })
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${targetSheet}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: processedRows
      }
    });

    if (isHeader) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true, fontSize: 11 },
                    horizontalAlignment: "CENTER"
                  }
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
              }
            }
          ]
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error appending to sheet:", error);
    res.status(500).json({ error: (error as any).message });
  }
});

app.post("/api/sheets/delete-rows", async (req, res) => {
  const { tokens, spreadsheetId, sheetName, pdfUrl, pageNumber } = req.body;
  try {
    const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: "v4", auth: client });

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName) || spreadsheet.data.sheets?.[0];
    const sheetId = sheet?.properties?.sheetId || 0;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) return res.json({ success: true, deletedCount: 0 });

    const rowsToDelete: number[] = [];
    rows.forEach((row, index) => {
      const hasUrl = row.some(cell => cell === pdfUrl);
      const hasPage = row.some(cell => cell === pageNumber.toString());
      if (hasUrl && hasPage) {
        rowsToDelete.push(index);
      }
    });

    if (rowsToDelete.length === 0) return res.json({ success: true, deletedCount: 0 });

    const requests = rowsToDelete.reverse().map(rowIndex => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowIndex,
          endIndex: rowIndex + 1,
        }
      }
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });

    res.json({ success: true, deletedCount: rowsToDelete.length });
  } catch (error) {
    console.error("Error deleting rows:", error);
    res.status(500).json({ error: (error as any).message });
  }
});

export default app;
