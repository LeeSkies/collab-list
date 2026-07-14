import dayjs from 'dayjs'
import 'dayjs/locale/en'
import 'dayjs/locale/he'
import calendar from 'dayjs/plugin/calendar'
import relativeTime from 'dayjs/plugin/relativeTime'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

dayjs.extend(calendar)
dayjs.extend(relativeTime)
dayjs.extend(localizedFormat)

const resources = {
  en: {
    translation: {
      appName: 'Our groceries',
      login: 'Sign in',
      email: 'Email',
      password: 'Password',
      signingIn: 'Signing in…',
      logout: 'Sign out',
      loginError: 'We couldn’t sign you in. Check the email and password and try again.',
      loading: 'Preparing your list…',
      configMissing: 'Supabase is not configured yet.',
      configHelp: 'Copy .env.example to .env.local and add your browser-safe project values.',
      search: 'Find or add a product',
      create: 'Add {{name}}',
      empty: 'Your list is ready for its first product.',
      noMatches: 'No close matches. Use plus to add it.',
      unpicked: 'To buy',
      picked: 'Bought',
      quantity: 'Quantity',
      notes: 'Notes',
      optional: 'Optional',
      minus: 'Decrease quantity',
      plus: 'Increase quantity',
      edit: 'Edit {{name}}',
      pick: 'Bought',
      restore: 'Restore',
      restoreAll: 'Restore all',
      restoreAllTitle: 'Restore all bought products?',
      restoreAllBody: 'Choose from the options.',
      clearNotes: 'Clear notes',
      resetQuantities: 'Reset quantities to 1',
      clearProductNotes: 'Clear notes',
      save: 'Save changes',
      saving: 'Saving…',
      delete: 'Delete',
      cancel: 'Cancel',
      confirm: 'Confirm',
      discardTitle: 'Discard your changes?',
      discardBody: 'The changes in this drawer have not been saved.',
      discard: 'Discard',
      keepEditing: 'Keep editing',
      deleteTitle: 'Delete {{name}}?',
      deleteBody: 'This permanently deletes the product.',
      duplicate: 'That product is already on the list.',
      invalidName: 'Enter a product name between 1 and 80 characters.',
      invalidQuantity: 'Use a quantity from 1 to 999 with up to two decimal places.',
      invalidNotes: 'Notes can contain up to 500 characters.',
      conflict:
        'Someone changed this product while you were editing. Your input is preserved; review the latest version and save again.',
      requestFailed: 'That didn’t work. Your input is safe—please try again.',
      timeout: 'The request took too long. Please try again.',
      offline: 'You’re offline. Reconnect to load or change the list.',
      reconnecting: 'Connection lost. Reconnecting…',
      connected: 'Back online. List refreshed.',
      createdAt: 'Created',
      updatedAt: 'Updated',
      updatedBy: 'Updated by {{email}}',
      close: 'Close',
      language: 'Language',
      admin: 'Users',
      addUser: 'Add user',
      createUser: 'Create user',
      creatingUser: 'Creating…',
      users: 'Users',
      role: 'Role',
      member: 'Member',
      deleteUserTitle: 'Delete {{email}}?',
      deleteUserBody: 'This permanently removes the user’s account.',
      currentUser: 'You',
      updateReady: 'A new version is ready.',
      update: 'Update',
      productCreated: '{{name}} added.',
      productDeleted: '{{name}} deleted.'
    }
  },
  he: {
    translation: {
      appName: 'הקניות שלנו',
      login: 'כניסה',
      email: 'אימייל',
      password: 'סיסמה',
      signingIn: 'מתחבר…',
      logout: 'יציאה',
      loginError: 'לא הצלחנו להתחבר. בדקו את האימייל והסיסמה ונסו שוב.',
      loading: 'מכינים את הרשימה…',
      configMissing: 'Supabase עדיין לא מוגדר.',
      configHelp: 'העתיקו את ‎.env.example אל ‎.env.local והוסיפו את ערכי הפרויקט הציבוריים.',
      search: 'חיפוש או הוספת מוצר',
      create: 'הוספת {{name}}',
      empty: 'הרשימה מוכנה למוצר הראשון.',
      noMatches: 'לא נמצאו התאמות קרובות. אפשר להוסיף עם הפלוס.',
      unpicked: 'צריך לקנות',
      picked: 'נקנה',
      quantity: 'כמות',
      notes: 'הערות',
      optional: 'לא חובה',
      minus: 'הפחתת כמות',
      plus: 'הגדלת כמות',
      edit: 'עריכת {{name}}',
      pick: 'נקנה',
      restore: 'החזרה לרשימה',
      restoreAll: 'החזרת הכול לרשימה',
      restoreAllTitle: 'להחזיר את כל המוצרים שנקנו?',
      restoreAllBody: 'בחרו מהאפשרויות',
      clearNotes: 'ניקוי כל ההערות',
      resetQuantities: 'איפוס הכמויות ל־1',
      clearProductNotes: 'ניקוי ההערות',
      save: 'שמירת שינויים',
      saving: 'שומר…',
      delete: 'מחיקה',
      cancel: 'ביטול',
      confirm: 'אישור',
      discardTitle: 'לוותר על השינויים?',
      discardBody: 'השינויים במגירה עדיין לא נשמרו.',
      discard: 'ויתור',
      keepEditing: 'המשך עריכה',
      deleteTitle: 'למחוק את {{name}}?',
      deleteBody: 'המוצר יימחק לצמיתות.',
      duplicate: 'המוצר הזה כבר נמצא ברשימה.',
      invalidName: 'יש להזין שם מוצר באורך 1 עד 80 תווים.',
      invalidQuantity: 'יש להזין כמות בין 1 ל־999, עם עד שתי ספרות אחרי הנקודה.',
      invalidNotes: 'אפשר להזין עד 500 תווים בהערות.',
      conflict: 'מישהו שינה את המוצר בזמן העריכה. הטקסט שלכם נשמר—בדקו את הגרסה העדכנית ושמרו שוב.',
      requestFailed: 'הפעולה לא הצליחה. הקלט נשמר ואפשר לנסות שוב.',
      timeout: 'הבקשה ארכה יותר מדי. נסו שוב.',
      offline: 'אין חיבור לרשת. התחברו מחדש כדי לטעון או לשנות את הרשימה.',
      reconnecting: 'החיבור נותק. מתחברים מחדש…',
      connected: 'חזרנו לרשת. הרשימה עודכנה.',
      createdAt: 'נוצר',
      updatedAt: 'עודכן',
      updatedBy: 'עודכן על ידי {{email}}',
      close: 'סגירה',
      language: 'שפה',
      admin: 'משתמשים',
      addUser: 'הוספת משתמש',
      createUser: 'יצירת משתמש',
      creatingUser: 'יוצר…',
      users: 'משתמשים',
      role: 'תפקיד',
      member: 'משתמש',
      deleteUserTitle: 'למחוק את {{email}}?',
      deleteUserBody: 'חשבון המשתמש יימחק לצמיתות.',
      currentUser: 'אתם',
      updateReady: 'גרסה חדשה מוכנה.',
      update: 'עדכון',
      productCreated: '{{name}} נוסף.',
      productDeleted: '{{name}} נמחק.'
    }
  }
} as const

const stored = localStorage.getItem('grocery-language')
const detected = navigator.languages.some((language) => language.toLowerCase().startsWith('he'))
  ? 'he'
  : 'en'

void i18n.use(initReactI18next).init({
  resources,
  lng: stored === 'he' || stored === 'en' ? stored : detected,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export function applyDocumentLanguage(language: string) {
  const locale = language === 'he' ? 'he' : 'en'
  document.documentElement.lang = locale
  document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr'
  dayjs.locale(locale)
}

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', (language) => {
  const locale = language === 'he' ? 'he' : 'en'
  localStorage.setItem('grocery-language', locale)
  applyDocumentLanguage(locale)
})

export default i18n
