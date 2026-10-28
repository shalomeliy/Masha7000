# Technical Specification: ShiftSmart PWA

## 1. Technology Stack
- **Frontend Framework:** Next.js (App Router) או Vite + React + TypeScript.
- **Styling:** Tailwind CSS + Lucide React (icons).
- **State Management:** Zustand (לניהול סטייט מקומי באפליקציה) + TanStack Query (React Query) לסנכרון נתונים.
- **Date/Time Handling:** `dayjs` (כולל פלאגינים לניהול טווחים, שעות ואזורי זמן בארץ `Asia/Jerusalem`).
- **Google APIs:** Google Identity Services (GIS) / OAuth 2.0 PKCE, Google Calendar API, Google Drive API (AppDataFolder).
- **Hosting & Deployment:** Vercel (Static / Serverless Client-Side PWA).

## 2. Architecture & Data Flow
- **Client-Side Heavy SPA:** האפליקציה רצה בצד הלקוח (Client Browser). אין בסיס נתונים מרכזי (No Backend DB).
- **Google Drive Storage:** קבצי ה-JSON הבאים יישמרו ב-`appDataFolder` של המנהל:
  1. `workers.json` – רשימת עובדים, פרטים ותפקידים מורשים.
  2. `roles_definition.json` – רשימת התפקידים הגלובלית בארגון.
  3. `shift_definitions.json` – הגדרת משמרות 24/7 ודרישות תפקידים לכל משמרת (כולל כוננות 3 אנשים).
- **Google Calendar Integration:** כל שיבוץ משמרות נכתב ונקרא מתוך יומן ייעודי בשם `Smart Shifts` ביומן Google של המשתמש. מטא-דאטה (JSON) נשמער בתוך שדה הקישור/התיאור של אירוע הלו"ז (Description).

## 3. Data Schemas (TypeScript Interfaces)

```typescript
export interface Role {
  id: string;
  name: string; // e.g., "אחראי משמרת", "מוקדן"
}

export interface Worker {
  id: string;
  name: string;
  roleIds: string[]; // מזהי התפקידים שהעובד מוסמך אליהם
  constraints: Constraint[];
}

export interface Constraint {
  id: string;
  date: string; // YYYY-MM-DD
  reason: string;
}

export interface ShiftDefinition {
  id: string;
  name: string; // "בוקר", "צהריים", "לילה", "כוננות 24/7"
  isStandby?: boolean; // האם זו משמרת כוננות המורכבת מ-3 אנשים
  requiredHeadcount?: number; // לרוב 1 למשמרת רגילה, 3 לכוננות
  requiredRoleIds: string[]; // התפקידים הנדרשים לאיוש משמרת זו
  startTime: string; // "07:00"
  endTime: string; // "15:00"
}

export interface ShiftAssignment {
  id: string;
  date: string; // YYYY-MM-DD
  shiftDefinitionId: string;
  assignedWorkerIds: string[]; // רשימת מזהי העובדים ששובצו
  status: 'VALID' | 'HAS_CONFLICT' | 'MISSING_ROLE';
}
## 3. Key Modules & Algorithms to Implement

1. **Google Auth & API Client Wrapper:** מודול המנהל את טוקן הגישה (OAuth 2.0), קריאות ל-Google Calendar API (יצירה/עדכון אירועים ביומן `Smart Shifts`), ושמירה/קריאה של קבצי ה-JSON מ-Google Drive AppDataFolder.
2. **Voice Constraint Parser:** שימוש ב-`webkitSpeechRecognition` להמרת דיבור עברית לטקסט, בשילוב חילוץ תאריכים בסיסי (או העברת הטקסט הגולמי לשדה העובד).
3. **Gap & Conflict Analysis Engine:** פונקציה רקורסיבית/לולאה שרצה על סידור העבודה השבועי ומבצעת:
   * בדיקת חפיפה בין אילוץ העובד לבין שעת המשמרת.
   * בדיקה האם לכל עובד משובץ יש את ה-`roleId` הנדרש במשמרת.
   * בדיקה האם במשמרת כוננות יש בדיוק 3 עובדים מאוישים.
   * החזרת רשימת התראות (Gaps/Warnings) למנהל לצורך הצגה ב-Dashboard.
4. **Historical Archive (6 Months):** שליפת אירועים מיומן גוגל בטווח של עד 180 יום אחורה, עם שמירת Caching מקומי לשיפור הביצועים.
