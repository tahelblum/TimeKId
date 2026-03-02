# Parent Dashboard - מערכת ניהול לימודים להורים

אפליקציית Next.js לניהול לוחות זמנים, משימות ומבחנים של ילדים.

## התקנה מקומית

```bash
cd parent-dashboard
npm install
npm run dev
```

האתר יהיה זמין ב-http://localhost:3000

## העלאה ל-Vercel

### אופציה 1: דרך הממשק של Vercel
1. עלי את התיקייה ל-GitHub
2. היכנסי ל-https://vercel.com
3. לחצי "New Project"
4. בחרי את הריפו מ-GitHub
5. לחצי "Deploy"

### אופציה 2: דרך CLI
```bash
npm install -g vercel
vercel login
vercel
```

## מבנה הפרויקט

```
parent-dashboard/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── page.tsx      # Login page (/)
│   │   ├── signup/       # Signup page (/signup)
│   │   └── dashboard/    # Dashboard (/dashboard)
│   ├── components/       # React components
│   │   ├── LoginForm.tsx
│   │   ├── SignupForm.tsx
│   │   └── Dashboard.tsx
│   ├── contexts/         # React contexts
│   │   └── AuthContext.tsx
│   └── lib/              # Utilities
│       └── api.ts        # API configuration
├── public/               # Static files
└── package.json
```

## מה כלול

✅ מסך התחברות (Login)
✅ מסך הרשמה (Signup)
✅ Dashboard בסיסי
✅ Authentication context
✅ חיבור ל-Xano API
✅ עיצוב Tailwind מלא
✅ תמיכה בעברית (RTL)
✅ TypeScript

## הבא בתור

- [ ] יצירת ילד חדש
- [ ] רשימת ילדים
- [ ] ניהול מערכת שעות
- [ ] העלאת קבצים ל-BOT
- [ ] התראות
